// embed.js - WS402 Widget Embebible v2.0
(function() {
  'use strict';
  
  const script = document.currentScript;
  const resourceId = script.getAttribute('data-resource');
  const targetId = script.getAttribute('data-target') || 'ws402-embed';
  const autoplay = script.getAttribute('data-autoplay') !== 'false';
  
  // Extract base URL properly (remove script filename)
  const PROXY_URL = script.src.substring(0, script.src.lastIndexOf('/'));
  
  // Load Solana Web3
  const web3Script = document.createElement('script');
  web3Script.src = 'https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js';
  document.head.appendChild(web3Script);
  
  // Estado
  let ws = null;
  let token = null;
  let schema = null;
  let wallet = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  
  // Validaciones
  if (!resourceId) {
    console.error('WS402: data-resource attribute is required');
    return;
  }
  
  const container = document.getElementById(targetId);
  if (!container) {
    console.error(`WS402: Target element #${targetId} not found`);
    return;
  }
  
  // Inicializar
  init();
  
  async function init() {
    try {
      showPreview();
    } catch (error) {
      showError('Failed to load resource preview', error.message);
    }
  }
  
  async function showPreview() {
    try {
      // Obtener info del recurso
      const response = await fetch(`${PROXY_URL}/api/resource/${resourceId}/schema`);
      
      if (!response.ok) {
        throw new Error(`Resource not found (${response.status})`);
      }
      
      const data = await response.json();
      schema = data.ws402Schema || data;
      
      console.log('Schema loaded:', schema);
      
      // Convert lamports to SOL
      const pricePerSecondSOL = schema.pricing.pricePerSecond / 1e9;
      const totalPriceSOL = schema.pricing.totalPrice / 1e9;
      const pricePerMinuteSOL = pricePerSecondSOL * 60;
      const pricePerHourUSD = (pricePerMinuteSOL * 60 * 60).toFixed(2); // Approx at $60/SOL
      
      container.innerHTML = `
        <div class="ws402-preview" style="
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 12px;
          padding: 30px;
          text-align: center;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
        ">
          <div style="margin-bottom: 20px;">
            <div style="
              width: 60px;
              height: 60px;
              margin: 0 auto 15px;
              background: linear-gradient(135deg, #667eea, #764ba2);
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 30px;
            ">🎬</div>
            <h3 style="color: #fff; margin: 0 0 8px 0; font-size: 1.4rem;">${escapeHtml(schema.resourceInfo?.name || 'Premium Content')}</h3>
            <p style="color: #888; margin: 0; font-size: 0.85rem;">${escapeHtml(schema.resourceInfo?.description || '')}</p>
          </div>
          
          <div style="
            background: rgba(255, 255, 255, 0.05);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
          ">
            <div style="color: #aaa; font-size: 0.9rem; margin-bottom: 8px;">
              💰 <strong style="color: #fff;">${pricePerSecondSOL.toFixed(9)} SOL/sec</strong>
            </div>
            <div style="color: #888; font-size: 0.85rem;">
              ≈ ${pricePerMinuteSOL.toFixed(6)} SOL/min (~$${pricePerHourUSD}/hr)
            </div>
          </div>
          
          <button 
            id="ws402-pay-btn"
            onclick="window.WS402_pay_${resourceId}()"
            style="
              background: linear-gradient(135deg, #667eea, #764ba2);
              color: white;
              border: none;
              padding: 15px 40px;
              border-radius: 10px;
              font-size: 1.1rem;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.3s;
              box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            "
            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(102, 126, 234, 0.6)';"
            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.4)';"
          >
            🔓 Pay & Watch
          </button>
          
          <div style="margin-top: 15px;">
            <div style="color: #667eea; font-size: 0.9rem; font-weight: 600; margin-bottom: 5px;">
              Total: ${totalPriceSOL.toFixed(6)} SOL
            </div>
            <div style="color: #666; font-size: 0.75rem;">
              (${schema.pricing.estimatedDuration}s estimated · Auto-refund unused)
            </div>
          </div>
          
          <p style="color: #666; font-size: 0.75rem; margin-top: 20px; margin-bottom: 0;">
            Powered by <strong style="color: #888;">WS402</strong> · Pay-as-you-go
          </p>
        </div>
      `;
      
      // Exponer función de pago
      window[`WS402_pay_${resourceId}`] = pay;
      
    } catch (error) {
      showError('Failed to load resource', error.message);
    }
  }
  
  async function pay() {
    const payBtn = document.getElementById('ws402-pay-btn');
    
    try {
      // 1. Verificar Phantom
      if (!window.solana || !window.solana.isPhantom) {
        showPhantomPrompt();
        return;
      }
      
      // Wait for web3 to load
      if (!window.solanaWeb3) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!window.solanaWeb3) {
          throw new Error('Solana Web3 failed to load');
        }
      }
      
      // Deshabilitar botón
      if (payBtn) {
        payBtn.disabled = true;
        payBtn.textContent = 'Connecting wallet...';
      }
      
      // 2. Conectar wallet
      const response = await window.solana.connect();
      wallet = response.publicKey.toString();
      
      console.log('✅ Wallet connected:', wallet);
      
      if (payBtn) payBtn.textContent = 'Creating transaction...';
      showLoading('Creating transaction...');
      
      // 3. Get payment details
      const totalPriceLamports = schema.pricing.totalPrice;
      const merchantWallet = schema.paymentDetails.recipient;
      const reference = schema.paymentDetails.reference;
      
      // 4. Get blockhash
      const blockhashResponse = await fetch(`${PROXY_URL}/blockhash`);
      if (!blockhashResponse.ok) {
        throw new Error('Failed to get blockhash');
      }
      const { blockhash } = await blockhashResponse.json();
      
      // 5. Create transaction
      const { Transaction, SystemProgram, PublicKey } = window.solanaWeb3;
      
      const fromPubkey = new PublicKey(wallet);
      const toPubkey = new PublicKey(merchantWallet);
      const referencePubkey = new PublicKey(reference);
      
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: fromPubkey
      });
      
      // Add transfer instruction
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: fromPubkey,
        toPubkey: toPubkey,
        lamports: totalPriceLamports
      });
      
      // Add reference to instruction keys
      transferInstruction.keys.push({
        pubkey: referencePubkey,
        isSigner: false,
        isWritable: false
      });
      
      transaction.add(transferInstruction);
      
      if (payBtn) payBtn.textContent = 'Approve in Phantom...';
      showLoading('Please approve transaction in Phantom...');
      
      // 6. Sign and send
      const { signature } = await window.solana.signAndSendTransaction(transaction);
      
      console.log('✅ Transaction sent:', signature);
      
      if (payBtn) payBtn.textContent = 'Verifying payment...';
      showLoading('Verifying payment...');
      
      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 7. Conectar WebSocket
      const wsUrl = schema.websocketEndpoint + encodeURIComponent(wallet);
      console.log('Connecting to:', wsUrl);
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        
        // Send payment proof
        ws.send(JSON.stringify({
          type: 'payment_proof',
          proof: {
            signature: signature,
            reference: reference,
            amount: totalPriceLamports
          }
        }));
        
        showLoading('Verifying payment...');
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Message:', data.type);
          
          if (data.type === 'session_started') {
            console.log('✅ Session started');
          }
          
          if (data.type === 'http_access_granted') {
            console.log('✅ Access granted');
            token = data.httpToken;
            showPlayer(data.resourceUrl);
          }
          
          if (data.type === 'usage_update') {
            updateStats(data);
          }
          
          if (data.type === 'session_end') {
            console.log('🏁 Session ended');
            showSessionEnd(data);
          }
          
          if (data.type === 'payment_rejected') {
            throw new Error(data.reason || 'Payment rejected');
          }
        } catch (error) {
          console.error('Error processing message:', error);
          showError('Error', error.message);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        handleConnectionError();
      };
      
      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        if (!token && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          showLoading(`Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(() => connectWebSocket(signature, reference, totalPriceLamports), 2000);
        }
      };
      
    } catch (error) {
      console.error('Payment error:', error);
      
      if (error.message?.includes('User rejected')) {
        showError('Payment cancelled', 'You rejected the wallet connection or transaction.');
      } else {
        showError('Payment failed', error.message);
      }
      
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.textContent = '🔓 Pay & Watch';
      }
    }
  }
  
  function connectWebSocket(signature, reference, amount) {
    const wsUrl = schema.websocketEndpoint + encodeURIComponent(wallet);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('✅ WebSocket reconnected');
      ws.send(JSON.stringify({
        type: 'payment_proof',
        proof: { signature, reference, amount }
      }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('📨 Message:', data.type);
      
      if (data.type === 'session_started') {
        console.log('✅ Session started');
      }
      
      if (data.type === 'http_access_granted') {
        console.log('✅ Access granted');
        token = data.httpToken;
        showPlayer(data.resourceUrl);
      }
      
      if (data.type === 'usage_update') {
        updateStats(data);
      }
      
      if (data.type === 'session_end') {
        console.log('🏁 Session ended');
        showSessionEnd(data);
      }
      
      if (data.type === 'payment_rejected') {
        showError('Payment rejected', data.reason);
      }
    };
  }
  
  function showPhantomPrompt() {
    container.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 12px;
        padding: 40px;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.1);
      ">
        <div style="font-size: 60px; margin-bottom: 20px;">👻</div>
        <h3 style="color: #fff; margin-bottom: 15px;">Phantom Wallet Required</h3>
        <p style="color: #aaa; margin-bottom: 25px;">
          You need Phantom wallet to pay for this content.
        </p>
        <a 
          href="https://phantom.app" 
          target="_blank"
          style="
            display: inline-block;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            padding: 15px 40px;
            border-radius: 10px;
            font-weight: 600;
          "
        >
          Install Phantom
        </a>
        <p style="color: #666; font-size: 0.85rem; margin-top: 20px;">
          Then refresh this page to continue
        </p>
      </div>
    `;
  }
  
  function showLoading(message = 'Processing payment...') {
    container.innerHTML = `
      <div style="
        background: #1a1a2e;
        padding: 50px;
        text-align: center;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      ">
        <div style="
          border: 4px solid rgba(102, 126, 234, 0.2);
          border-top: 4px solid #667eea;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: ws402-spin 1s linear infinite;
          margin: 0 auto 20px;
        "></div>
        <p style="color: #fff; margin: 0; font-size: 1.1rem;">${escapeHtml(message)}</p>
      </div>
      <style>
        @keyframes ws402-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    `;
  }
  
  function showPlayer(resourceUrl) {
    // Detect media type from URL or schema
    const url = `${PROXY_URL}${resourceUrl}`;
    const urlLower = url.toLowerCase();
    let mediaElement = '';
    
    // Detect image types
    if (urlLower.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|$)/i)) {
      mediaElement = `
        <img 
          id="ws402-player"
          style="width: 100%; max-height: 600px; object-fit: contain; display: block; background: #000; border-radius: 8px 8px 0 0;"
          src="${url}"
          alt="Protected content"
        />
      `;
    }
    // Detect video types
    else if (urlLower.match(/\.(mp4|webm|ogg|mov)(\?|$)/i)) {
      mediaElement = `
        <video 
          id="ws402-player"
          controls 
          ${autoplay ? 'autoplay' : ''}
          style="width: 100%; max-height: 600px; display: block; background: #000; border-radius: 8px 8px 0 0;"
          src="${url}"
        >
          Your browser does not support video playback.
        </video>
      `;
    }
    // Detect audio types
    else if (urlLower.match(/\.(mp3|wav|ogg|m4a|flac)(\?|$)/i)) {
      mediaElement = `
        <div style="background: #000; padding: 40px; border-radius: 8px 8px 0 0;">
          <div style="text-align: center; color: #fff; font-size: 3rem; margin-bottom: 20px;">🎵</div>
          <audio 
            id="ws402-player"
            controls 
            ${autoplay ? 'autoplay' : ''}
            style="width: 100%; display: block;"
            src="${url}"
          >
            Your browser does not support audio playback.
          </audio>
        </div>
      `;
    }
    // Detect PDF
    else if (urlLower.match(/\.pdf(\?|$)/i)) {
      mediaElement = `
        <iframe 
          id="ws402-player"
          style="width: 100%; height: 600px; border: none; border-radius: 8px 8px 0 0; background: #fff;"
          src="${url}"
        ></iframe>
      `;
    }
    // Default: iframe for everything else (HTML, websites, etc.)
    else {
      mediaElement = `
        <iframe 
          id="ws402-player"
          style="width: 100%; height: 500px; border: none; border-radius: 8px 8px 0 0;"
          src="${url}"
        ></iframe>
      `;
    }
    
    container.innerHTML = `
      <div style="
        background: #000;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      ">
        ${mediaElement}
        <div id="ws402-stats" style="
          background: linear-gradient(135deg, #1a1a2e, #16213e);
          padding: 15px 20px;
          color: #aaa;
          font-size: 0.9rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        ">
          <div>
            ⏱️ <span id="ws402-time">0s</span>
          </div>
          <div>
            💰 <span id="ws402-balance" style="color: #67ea94;">0 SOL</span> remaining
          </div>
          <div style="font-size: 0.75rem; color: #666;">
            Powered by WS402
          </div>
        </div>
      </div>
    `;
    
    console.log('✅ Player loaded');
  }
  
  function updateStats(data) {
    const timeEl = document.getElementById('ws402-time');
    const balanceEl = document.getElementById('ws402-balance');
    
    if (timeEl) {
      const minutes = Math.floor(data.elapsedSeconds / 60);
      const seconds = data.elapsedSeconds % 60;
      timeEl.textContent = minutes > 0 
        ? `${minutes}m ${seconds}s` 
        : `${seconds}s`;
    }
    
    if (balanceEl) {
      // Convert lamports to SOL
      const balanceSOL = data.remainingBalance / 1e9;
      balanceEl.textContent = balanceSOL.toFixed(6) + ' SOL';
      
      // Warning si se está acabando el balance
      const pricePerSecondLamports = schema.pricing.pricePerSecond;
      if (data.remainingBalance < pricePerSecondLamports * 30) {
        balanceEl.style.color = '#f59e0b'; // orange
      }
      if (data.remainingBalance < pricePerSecondLamports * 10) {
        balanceEl.style.color = '#ef4444'; // red
      }
    }
  }
  
  function showSessionEnd(data) {
    // Convert lamports to SOL
    const consumedSOL = (data.consumedAmount || 0) / 1e9;
    const refundSOL = (data.refundAmount || 0) / 1e9;
    
    container.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 12px;
        padding: 40px;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.1);
      ">
        <div style="font-size: 60px; margin-bottom: 20px;">✅</div>
        <h3 style="color: #fff; margin-bottom: 15px;">Session Complete</h3>
        <div style="
          background: rgba(255, 255, 255, 0.05);
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        ">
          <div style="color: #aaa; margin-bottom: 10px;">
            ⏱️ Watch time: <strong style="color: #fff;">${data.elapsedSeconds}s</strong>
          </div>
          <div style="color: #aaa; margin-bottom: 10px;">
            💸 Charged: <strong style="color: #fff;">${consumedSOL.toFixed(6)} SOL</strong>
          </div>
          ${refundSOL > 0 ? `
            <div style="color: #67ea94;">
              💰 Refunded: <strong>${refundSOL.toFixed(6)} SOL</strong>
            </div>
          ` : ''}
        </div>
        <button 
          onclick="location.reload()"
          style="
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1rem;
          "
        >
          Watch Again
        </button>
      </div>
    `;
  }
  
  function showError(title, message) {
    container.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 12px;
        padding: 40px;
        text-align: center;
        border: 1px solid rgba(239, 68, 68, 0.3);
      ">
        <div style="font-size: 60px; margin-bottom: 20px;">❌</div>
        <h3 style="color: #ef4444; margin-bottom: 15px;">${escapeHtml(title)}</h3>
        <p style="color: #aaa; margin-bottom: 25px;">
          ${escapeHtml(message)}
        </p>
        <button 
          onclick="location.reload()"
          style="
            background: rgba(239, 68, 68, 0.2);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.3);
            padding: 12px 30px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1rem;
          "
        >
          Try Again
        </button>
      </div>
    `;
  }
  
  function handleConnectionError() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      showLoading(`Connection lost. Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    } else {
      showError('Connection Failed', 'Unable to establish connection after multiple attempts.');
    }
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Cleanup
  window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
  
  console.log('✅ WS402 Widget initialized:', resourceId);
  
})();