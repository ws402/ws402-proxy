# 🚀 WS402 Proxy Service

> Monetize any URL in 30 seconds. Zero code. Zero installation. Fair pay-as-you-go pricing.

A production-ready service that lets creators monetize any web resource (videos, PDFs, APIs, etc.) using the WS402 protocol and Solana blockchain payments.

## 🎯 What is WS402 Proxy?

WS402 Proxy transforms any URL into a protected, pay-per-use resource. Users pay only for what they consume (per-second pricing), with automatic refunds for unused balance.

**Perfect for:**
- 🎓 Online courses & tutorials
- 📰 Premium articles & reports
- 🎵 Music & podcast streaming
- 🔌 API access monetization
- 🎬 Video rentals
- 📄 E-books & documents

## ✨ Key Features

- ⚡ **Instant Setup** - Paste URL, set price, get protected link
- 💰 **Fair Pricing** - Users pay only for actual consumption
- 🔄 **Auto Refunds** - Unused balance returned automatically
- 🌐 **Universal** - Works with any URL or file type
- 📊 **Real-time Stats** - Live usage tracking for users
- 🔐 **Secure** - WebSocket-based payment verification
- 🎨 **Embeddable** - Widget works on any website

## 🚀 Quick Start

### Prerequisites

- Node.js 16+
- npm
- Phantom Wallet (for testing)

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/ws402-proxy.git
cd ws402-proxy

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start server
npm start
```

### Generate Service Wallet

```bash
node -e "const {Keypair}=require('@solana/web3.js'); console.log(JSON.stringify(Array.from(Keypair.generate().secretKey)))"
```

Copy the output and paste it in `.env` as `SERVICE_WALLET_PRIVATE_KEY`.

### Fund Your Wallet (Devnet)

Visit https://faucet.solana.com/ and request devnet SOL for your wallet address.

## 📖 Usage

### 1. Create a Protected Resource

Visit `http://localhost:3000` and fill in the form:
- **URL:** Your content URL
- **Title:** Resource title
- **Price per Second:** 0.0001 SOL
- **Duration:** 600 seconds
- **Your Wallet:** Your Solana address

### 2. Share the Link

You'll get:
- Access URL for direct viewing
- Embed code for your website
- WebSocket schema endpoint

### 3. Embed Anywhere

```html
<div id="video-player"></div>
<script src="http://localhost:3000/embed.js" 
        data-resource="YOUR_RESOURCE_ID"
        data-target="video-player">
</script>
```

## 🎨 Demo

Visit `http://localhost:3000/demo.html` to see the widget in action!

## 🔌 API Endpoints

- `POST /api/mask` - Create masked resource
- `GET /api/resource/:id/schema` - Get WS402 schema
- `GET /api/resource/:id` - Get resource info
- `GET /proxy/:id?token=xxx` - Access protected resource
- `GET /watch/:id` - Watch page
- `GET /health` - Health check

## 📁 Project Structure

```
ws402-proxy/
├── src/
│   ├── server.js                    # Main server
│   ├── services/
│   │   ├── MaskingService.js        # Resource masking
│   │   └── ProxyService.js          # Content proxying
│   └── providers/
│       └── SolanaPaymentProvider.js # Solana integration
├── public/
│   ├── index.html                   # Landing page
│   ├── watch.html                   # Watch page
│   ├── demo.html                    # Demo page
│   └── embed.js                     # Widget script
├── package.json
├── .env.example
└── README.md
```

## 💰 Business Model

- **Service Fee:** 5% (configurable)
- **Creator Share:** 95%
- **Payment:** Instant on-chain
- **Refunds:** Automatic

## 🔐 Security

- ✅ Payment verification on blockchain
- ✅ WebSocket session management
- ✅ Token-based HTTP access
- ✅ Input validation & sanitization
- ✅ CORS configuration

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a PR.

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- [WS402 Protocol](https://github.com/ws402) - WebSocket payment standard
- [Solana](https://solana.com) - Fast, secure blockchain
- [Phantom](https://phantom.app) - Solana wallet

## 💬 Support

- Email: support@ws402.com
- Twitter: [@ws402](https://twitter.com/ws402)
- Discord: Join our server

---

**Built for Solana Hackathon 2024**  
**Made with ❤️ by the WS402 team**