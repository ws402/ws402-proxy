// src/server.js
// WS402 Proxy Service - FINAL VERSION
// Based on functional ws402 + Solana examples

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const { 
  Connection, 
  PublicKey, 
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');

// Import from ws402 library
const {
  WS402,
  SolanaPaymentProvider,
} = require('ws402');

const MaskingService = require('./services/MaskingService');
const ProxyService = require('./services/ProxyService');

// Initialize Express
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Initialize Services
const maskingService = new MaskingService();
const proxyService = new ProxyService(maskingService);


function isValidMediaUrl(url) {
  const urlLower = url.toLowerCase();
  
  const validExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico',
    '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv',
    '.mp3', '.wav', '.m4a', '.flac', '.aac',
    '.pdf'
  ];
  
  const hasValidExtension = validExtensions.some(ext => urlLower.includes(ext));
  
  if (!hasValidExtension) {
    return {
      valid: false,
      error: 'URL must point to a media file (image, video, audio, or PDF)',
      allowedTypes: 'Images, Videos, Audio, PDFs'
    };
  }
  
  const invalidPatterns = [/\.html?(\?|$)/i, /\.php(\?|$)/i];
  
  for (const pattern of invalidPatterns) {
    if (pattern.test(url)) {
      return {
        valid: false,
        error: 'Cannot protect HTML pages. Only direct media files supported.'
      };
    }
  }
  
  return { valid: true };
}

// ===== SOLANA CONFIGURATION =====

// Parse merchant private key (supports JSON array and base58)
let merchantPrivateKey = undefined;

if (process.env.SERVICE_WALLET_PRIVATE_KEY) {
  try {
    const pkString = process.env.SERVICE_WALLET_PRIVATE_KEY.trim();
    
    // JSON array format: [1,2,3,...]
    if (pkString.startsWith('[')) {
      merchantPrivateKey = JSON.parse(pkString);
      console.log('✅ Merchant private key loaded (JSON array format)');
    } 
    // Base58 format (from Phantom/Solflare)
    else {
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      
      function base58Decode(str) {
        const bytes = [0];
        for (let i = 0; i < str.length; i++) {
          const value = ALPHABET.indexOf(str[i]);
          if (value === -1) throw new Error('Invalid base58 character');
          
          for (let j = 0; j < bytes.length; j++) {
            bytes[j] *= 58;
          }
          bytes[0] += value;
          
          let carry = 0;
          for (let j = 0; j < bytes.length; j++) {
            bytes[j] += carry;
            carry = bytes[j] >> 8;
            bytes[j] &= 0xff;
          }
          while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
          }
        }
        
        for (let i = 0; i < str.length && str[i] === '1'; i++) {
          bytes.push(0);
        }
        
        return new Uint8Array(bytes.reverse());
      }
      
      merchantPrivateKey = Array.from(base58Decode(pkString));
      console.log('✅ Merchant private key loaded (base58 format)');
    }
    
    if (merchantPrivateKey.length !== 64) {
      throw new Error(`Invalid private key length: ${merchantPrivateKey.length} (expected 64)`);
    }
    
  } catch (error) {
    console.error('❌ Error loading SERVICE_WALLET_PRIVATE_KEY:', error.message);
    console.error('⚠️  Continuing without automatic refunds...');
    merchantPrivateKey = undefined;
  }
}

// Initialize SolanaPaymentProvider (CORRECT FORMAT)
const solanaProvider = new SolanaPaymentProvider({
  rpcEndpoint: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  merchantWallet: process.env.SERVICE_WALLET_PUBLIC_KEY || generateDevnetWallet(),
  merchantPrivateKey: merchantPrivateKey,
  network: process.env.SOLANA_NETWORK || 'devnet',
  conversionRate: 1, // 1:1 (lamports to lamports)
  label: 'WS402 Proxy Payment',
  message: 'Pay for protected resource access',
  memo: 'WS402Proxy',
  autoRefund: true,
  paymentTimeout: 300000, // 5 minutes
});

console.log('💳 Solana Provider initialized:', solanaProvider.getConnectionInfo());

// WebSocket Server for WS402
const wss = new WebSocket.Server({ 
  server, 
  path: '/ws402' 
});

// Session tracking
const sessionToResource = new Map();
const httpSessions = new Map();
let userIdToWs = new Map();

// ===== WS402 CONFIGURATION =====

// CRITICAL: Use LAMPORTS as currency, not SOL
const ws402 = new WS402(
  {
    updateInterval: 3000, // 3 seconds
    pricePerSecond: 100000, // Default: 0.0001 SOL (100,000 lamports) per second
    currency: 'lamports', // IMPORTANT: use lamports, not SOL
    maxSessionDuration: parseInt(process.env.MAX_SESSION_DURATION) || 3600,
    
    userIdExtractor: (req) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const userId = url.searchParams.get('userId') || 'anonymous';
        const resourceId = url.searchParams.get('resourceId');
        
        // Pass resourceId to request
        if (resourceId) {
          req._resourceId = resourceId;
        }
        
        return userId;
      } catch {
        return 'anonymous';
      }
    },
    
    onPaymentVerified: (session) => {
      const resourceId = session._resourceId;
      const resource = maskingService.getResource(resourceId);
      
      console.log(`✅ Payment verified: ${session.sessionId}`);
      console.log(`   User: ${session.userId.slice(0, 8)}...`);
      console.log(`   Resource: ${resourceId}`);
      console.log(`   Amount: ${formatSOL(session.paidAmount)}`);
      
      if (!resource) {
        console.error(`❌ Resource not found: ${resourceId}`);
        return;
      }
      
      console.log(`   Price: ${formatSOL(resource.pricePerSecond)}/sec`);
      
      // CRITICAL: Override session price with resource-specific price
      // Resource has its price in lamports
      session.pricePerSecond = resource.pricePerSecond;
      
      // Track session-resource relationship
      sessionToResource.set(session.sessionId, resourceId);
      
      // Generate HTTP token
      const httpToken = `token_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      httpSessions.set(httpToken, {
        sessionId: session.sessionId,
        resourceId: resourceId,
        userId: session.userId,
        pricePerSecond: resource.pricePerSecond,
        startTime: Date.now()
      });
      
      // Find user's WebSocket and send token
      const ws = userIdToWs.get(session.userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'http_access_granted',
          sessionId: session.sessionId,
          httpToken: httpToken,
          resourceUrl: `/proxy/${resourceId}?token=${httpToken}`,
          message: 'Access granted - you can now view the resource',
          resourceInfo: {
            name: resource.title,
            type: resource.type,
            pricePerSecond: resource.pricePerSecond,
            priceSOL: formatSOL(resource.pricePerSecond)
          }
        }));
      }
    },
    
    onRefundIssued: (session, refund) => {
      console.log(`💰 Refund issued: ${formatSOL(refund.amount)}`);
      console.log(`   Session: ${session.sessionId.slice(0, 16)}...`);
      console.log(`   Reason: ${refund.reason}`);
    },
    
    onSessionEnd: async (session) => {
      const resourceId = sessionToResource.get(session.sessionId);
      
      console.log(`📊 Session ended: ${session.sessionId.slice(0, 16)}...`);
      console.log(`   Duration: ${session.elapsedSeconds}s`);
      console.log(`   Consumed: ${formatSOL(session.consumedAmount)}`);
      console.log(`   Refunded: ${formatSOL(session.paidAmount - session.consumedAmount)}`);
      
      // Cleanup session tracking
      sessionToResource.delete(session.sessionId);
      
      // Remove HTTP token
      for (const [token, data] of httpSessions.entries()) {
        if (data.sessionId === session.sessionId) {
          httpSessions.delete(token);
          break;
        }
      }
      
      // Remove WebSocket mapping
      userIdToWs.delete(session.userId);
      
      // Record analytics and pay creator
      if (resourceId) {
        const resource = maskingService.getResource(resourceId);
        if (resource) {
          // Record analytics
          maskingService.recordView(resourceId, {
            userId: session.userId,
            elapsedSeconds: session.elapsedSeconds,
            consumedAmount: session.consumedAmount
          });
          
          // Pay creator (95% - 5% fee)
          if (session.consumedAmount > 0) {
            await payCreator(resource.creatorWallet, session.consumedAmount);
          }
        }
      }
    },
  },
  solanaProvider
);

// Attach WS402 and get user mapping
userIdToWs = ws402.attach(wss);

// ===== HTTP ROUTES =====

// 1. Create masked resource
app.post('/api/mask', async (req, res) => {
  try {
    const { originalUrl, pricePerSecond, estimatedDuration, title, creatorWallet } = req.body;
    // Validation
    if (!originalUrl) {
      return res.status(400).json({ error: 'originalUrl is required' });
    }
    
    if (!creatorWallet) {
      return res.status(400).json({ error: 'creatorWallet is required' });
    }
    
    if (!maskingService.isValidUrl(originalUrl)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    const validation = isValidMediaUrl(originalUrl);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error,
        allowedTypes: validation.allowedTypes
      });
    }
    // Validate price is in lamports (large numbers)
    const priceInLamports = parseFloat(pricePerSecond);
    const minPrice = parseFloat(process.env.MIN_PRICE_PER_SECOND) || 1000; // 1000 lamports minimum
    
    if (priceInLamports < minPrice) {
      return res.status(400).json({ 
        error: `Price must be at least ${minPrice} lamports per second (${formatSOL(minPrice)}/sec)` 
      });
    }
    
    // Validate Solana wallet
    try {
      new PublicKey(creatorWallet);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid Solana wallet address' });
    }
    
    // Create masked resource
    const masked = await maskingService.createMaskedResource({
      originalUrl,
      pricePerSecond: priceInLamports, // Store in lamports
      estimatedDuration: parseInt(estimatedDuration) || 300,
      title: title || 'Untitled Resource',
      creatorWallet,
      createdAt: Date.now()
    });
    
    // Generate response
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    
    res.json({
      success: true,
      maskedId: masked.id,
      accessUrl: `${baseUrl}/watch/${masked.id}`,
      schemaUrl: `${baseUrl}/api/resource/${masked.id}/schema`,
      embedCode: `<script src="${baseUrl}/embed.js" data-resource="${masked.id}"></script>`,
      qrCode: `${baseUrl}/api/qr/${masked.id}`,
      analytics: `${baseUrl}/dashboard/${masked.id}`,
      resource: {
        id: masked.id,
        title: masked.title,
        type: masked.type,
        pricePerSecond: masked.pricePerSecond,
        priceSOL: formatSOL(masked.pricePerSecond),
        estimatedDuration: masked.estimatedDuration,
        totalEstimatedCost: masked.pricePerSecond * masked.estimatedDuration,
        totalEstimatedCostSOL: formatSOL(masked.pricePerSecond * masked.estimatedDuration)
      }
    });
    
  } catch (error) {
    console.error('Error creating masked resource:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Get resource schema (WS402)
app.get('/api/resource/:maskedId/schema', (req, res) => {
  try {
    const { maskedId } = req.params;
    const resource = maskingService.getResource(maskedId);
    
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // Generate schema with resource price (in lamports)
    const schema = ws402.generateSchema(
      maskedId,
      resource.estimatedDuration,
      resource.pricePerSecond // Price in lamports
    );
    
    // Configure WebSocket endpoint
    const wsProtocol = req.protocol === 'https' ? 'wss' : 'ws';
    schema.websocketEndpoint = `${wsProtocol}://${req.headers.host}/ws402?resourceId=${maskedId}&userId=`;
    
    // Add resource information
    schema.resourceInfo = {
      name: resource.title,
      type: resource.type,
      estimatedTime: resource.estimatedDuration,
      priceSOL: formatSOL(resource.pricePerSecond),
      totalPriceSOL: formatSOL(resource.pricePerSecond * resource.estimatedDuration)
    };
    
    res.json({ ws402Schema: schema });
    
  } catch (error) {
    console.error('Error generating schema:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Proxy the actual resource (protected by token)
app.get('/proxy/:maskedId', async (req, res) => {
  try {
    const { maskedId } = req.params;
    const { token } = req.query;
    
    console.log('Resource access request:', maskedId);
    
    // Verify token
    const httpSession = httpSessions.get(token);
    
    if (!httpSession || httpSession.resourceId !== maskedId) {
      return res.status(403).json({ 
        error: 'Invalid or expired token',
        message: 'Please obtain a valid access token by completing payment'
      });
    }
    
    // Get resource
    const resource = maskingService.getResource(maskedId);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // Log access
    console.log(`📄 Serving resource ${maskedId} for session ${httpSession.sessionId.slice(0, 16)}...`);
    
    // Proxy the original resource
    await proxyService.proxyResource(resource.originalUrl, req, res);
    
  } catch (error) {
    console.error('Error proxying resource:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// 4. Watch page
app.get('/watch/:maskedId', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/watch.html'));
});

// 5. Embed demo page
app.get('/embed-demo', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/embed-demo.html'));
});

// 6. Get resources list
app.get('/api/resources', (req, res) => {
  const resources = maskingService.getAllResources();
  
  const resourceList = resources.map(resource => ({
    id: resource.id,
    title: resource.title,
    type: resource.type,
    pricePerSecond: resource.pricePerSecond,
    priceSOL: formatSOL(resource.pricePerSecond),
    estimatedDuration: resource.estimatedDuration,
    totalPrice: resource.pricePerSecond * resource.estimatedDuration,
    totalPriceSOL: formatSOL(resource.pricePerSecond * resource.estimatedDuration),
    views: resource.views || 0,
    createdAt: resource.createdAt
  }));
  
  res.json({ resources: resourceList });
});

// 7. Get masked resource info (public)
app.get('/api/resource/:maskedId', (req, res) => {
  try {
    const { maskedId } = req.params;
    const resource = maskingService.getResource(maskedId);
    
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // Return public info (hide original URL)
    res.json({
      id: resource.id,
      title: resource.title,
      type: resource.type,
      pricePerSecond: resource.pricePerSecond,
      priceSOL: formatSOL(resource.pricePerSecond),
      estimatedDuration: resource.estimatedDuration,
      totalEstimatedCost: resource.pricePerSecond * resource.estimatedDuration,
      totalEstimatedCostSOL: formatSOL(resource.pricePerSecond * resource.estimatedDuration),
      createdAt: resource.createdAt,
      views: resource.views || 0
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Analytics endpoint
app.get('/api/resource/:maskedId/analytics', (req, res) => {
  try {
    const { maskedId } = req.params;
    const analytics = maskingService.getAnalytics(maskedId);
    
    if (!analytics) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Blockhash endpoint (for client transactions)
app.get('/blockhash', async (req, res) => {
  try {
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    res.json({ blockhash, lastValidBlockHeight });
  } catch (error) {
    console.error('Blockhash error:', error);
    res.status(500).json({ 
      error: 'Failed to get blockhash',
      message: error.message 
    });
  }
});

// 10. Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeSessions: ws402.getActiveSessions().length,
    activeHTTPSessions: httpSessions.size,
    maskedResources: maskingService.getResourceCount(),
    solanaProvider: solanaProvider.getConnectionInfo(),
    timestamp: Date.now()
  });
});

// 11. Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== HELPER FUNCTIONS =====

/**
 * Format lamports to SOL
 */
function formatSOL(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9) + ' SOL';
}

/**
 * Pay creator
 */
async function payCreator(creatorWallet, consumedAmountLamports) {
  try {
    const serviceFee = parseFloat(process.env.SERVICE_FEE_PERCENTAGE) || 5;
    const creatorShareLamports = Math.floor(consumedAmountLamports * (1 - serviceFee / 100));
    
    if (creatorShareLamports < 1000) {
      console.log('⚠️  Creator payment too small, skipping');
      return;
    }
    
    console.log(`💸 Paying creator ${creatorWallet}:`);
    console.log(`   Consumed: ${formatSOL(consumedAmountLamports)}`);
    console.log(`   Service fee (${serviceFee}%): ${formatSOL(consumedAmountLamports * serviceFee / 100)}`);
    console.log(`   Creator receives: ${formatSOL(creatorShareLamports)}`);
    
    // On devnet, only log
    if (process.env.SOLANA_NETWORK === 'devnet') {
      console.log('✅ [DEVNET] Payment logged (not executed)');
      return;
    }
    
    // On production, execute transfer
    if (!merchantPrivateKey) {
      console.error('❌ Cannot pay creator: No private key configured');
      return;
    }
    
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    const merchantKeypair = Keypair.fromSecretKey(Uint8Array.from(merchantPrivateKey));
    
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: merchantKeypair.publicKey,
        toPubkey: new PublicKey(creatorWallet),
        lamports: creatorShareLamports
      })
    );
    
    const signature = await connection.sendTransaction(
      transaction,
      [merchantKeypair],
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      }
    );
    
    console.log(`✅ Creator payment sent: ${signature}`);
    console.log(`   Explorer: https://solscan.io/tx/${signature}`);
    
  } catch (error) {
    console.error('❌ Error paying creator:', error.message);
  }
}

/**
 * Generate devnet wallet if none provided
 */
function generateDevnetWallet() {
  const keypair = Keypair.generate();
  console.log('⚠️  No SERVICE_WALLET_PUBLIC_KEY found, generated temporary wallet:');
  console.log(`   Address: ${keypair.publicKey.toBase58()}`);
  console.log('   ⚠️  This wallet will be different on each restart!');
  console.log(`   💡 Get devnet SOL: solana airdrop 2 ${keypair.publicKey.toBase58()} --url devnet`);
  return keypair.publicKey.toBase58();
}

// ===== ERROR HANDLING =====

app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ===== CLEANUP =====

// Cleanup expired payments every hour
setInterval(() => {
  const cleaned = solanaProvider.cleanupExpiredPayments();
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired payments`);
  }
}, 3600000);

// ===== START SERVER =====

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  const connectionInfo = solanaProvider.getConnectionInfo();
  
  console.log('===========================================');
  console.log('🚀 WS402 Proxy Service Running');
  console.log('===========================================');
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws402`);
  console.log(`💰 Network: ${connectionInfo.network}`);
  console.log(`🦊 RPC: ${connectionInfo.rpcEndpoint}`);
  console.log(`💵 Service Fee: ${process.env.SERVICE_FEE_PERCENTAGE || 5}%`);
  console.log(`💲 Default Price: ${formatSOL(ws402.config.pricePerSecond)}/sec`);
  console.log(`📦 Merchant Wallet: ${connectionInfo.merchantWallet}`);
  console.log(`🔄 Auto-Refund: ${connectionInfo.autoRefundEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  
  if (!connectionInfo.autoRefundEnabled) {
    console.log('⚠️  Set SERVICE_WALLET_PRIVATE_KEY to enable automatic refunds');
  }
  
  console.log('===========================================');
  console.log('📋 Endpoints:');
  console.log(`  POST /api/mask - Create masked resource`);
  console.log(`  GET  /api/resources - List all resources`);
  console.log(`  GET  /api/resource/:id/schema - Get WS402 schema`);
  console.log(`  GET  /proxy/:id?token=xxx - Access resource`);
  console.log(`  GET  /watch/:id - View resource`);
  console.log(`  GET  /blockhash - Get Solana blockhash`);
  console.log(`  GET  /health - Health check`);
  console.log('===========================================');
  
  if (connectionInfo.network === 'devnet') {
    console.log('\n⚠️  DEVNET MODE - For testing only!');
    console.log('💡 Get SOL: https://faucet.solana.com/');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, ws402, maskingService };