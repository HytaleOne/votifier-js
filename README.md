# @hytaleone/votifier

[![npm version](https://img.shields.io/npm/v/@hytaleone/votifier.svg)](https://www.npmjs.com/package/@hytaleone/votifier)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript client for sending votes to Hytale and Minecraft servers using Votifier V1 and V2 (NuVotifier) protocols.

Used by server list websites to notify game servers when players vote. Compatible with Hytale, Minecraft servers running Votifier or NuVotifier plugins.

## Features

- **Votifier V1** - RSA encrypted votes (legacy servers)
- **Votifier V2 / NuVotifier** - HMAC-SHA256 signed votes with challenge-response
- **Zero dependencies** - Uses only Node.js built-in modules
- **TypeScript** - Full type definitions included
- **Retry-safe error handling** - Know when it's safe to retry failed votes
- **Dual format** - Works with both ESM and CommonJS

## Installation

```bash
npm install @hytaleone/votifier
```

## Usage

### Static Function

```typescript
import { sendVote } from '@hytaleone/votifier';

const result = await sendVote({
  server: {
    protocol: 'v2',
    host: 'play.example.com',
    port: 8192,
    token: 'your-secret-token',
  },
  vote: {
    username: 'PlayerName',
    serviceName: 'MyVotingSite',
    address: '127.0.0.1',
    timestamp: Date.now(),
  },
});

if (result.success) {
  console.log('Vote sent!');
} else {
  console.log('Failed:', result.errorType, result.message);
}
```

### Client Instance (for repeated votes to same server)

```typescript
import { VotifierClient } from '@hytaleone/votifier';

const client = new VotifierClient({
  protocol: 'v2',
  host: 'play.example.com',
  port: 8192,
  token: 'your-secret-token',
});

const result = await client.sendVote({
  username: 'PlayerName',
  serviceName: 'MyVotingSite',
  address: '127.0.0.1',
  timestamp: Date.now(),
});
```

### V1 Protocol

```typescript
import { sendVote } from '@hytaleone/votifier';

const result = await sendVote({
  server: {
    protocol: 'v1',
    host: 'play.example.com',
    port: 8192,
    publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  },
  vote: {
    username: 'PlayerName',
    serviceName: 'MyVotingSite',
    address: '127.0.0.1',
    timestamp: Date.now(),
  },
});
```

## API

### sendVote(options)

Send a single vote. Returns a result object (never throws for operational errors).

**Options:**
- `server.protocol` - `'v1'` or `'v2'`
- `server.host` - Server hostname
- `server.port` - Server port (default: 8192)
- `server.timeout` - Timeout in ms (default: 5000)
- `server.token` - Shared secret (V2)
- `server.publicKey` - RSA public key (V1)
- `vote.username` - Player's username
- `vote.serviceName` - Voting service name
- `vote.address` - Voter's IP
- `vote.timestamp` - Unix timestamp in ms

**Returns:**
- Success: `{ success: true, protocol, duration }`
- Failure: `{ success: false, errorType, message }`

**Error Types:**

| Type | Retry Safe? | Description |
|------|-------------|-------------|
| `'offline'` | ✅ Yes | Server not reachable, vote was not sent |
| `'uncertain'` | ⚠️ Maybe | Vote may have been received, retry could cause duplicate |
| `'rejected'` | ❌ No | Server rejected the vote |
| `'protocol'` | ❌ No | Invalid response, server misconfigured |
| `'unknown'` | ❓ You decide | Unexpected error |

### VotifierClient

```typescript
const client = new VotifierClient(serverConfig);
const result = await client.sendVote(vote);
const results = await client.sendVotes([vote1, vote2]);
```

## Error Handling & Retry

```typescript
const result = await sendVote({ server, vote });

if (!result.success) {
  switch (result.errorType) {
    case 'offline':
      // Server down - safe to retry later
      break;
    case 'uncertain':
      // Vote may have been received - retry with same timestamp
      break;
    case 'rejected':
      // Server said no - check token/key
      break;
    case 'protocol':
      // Bad response - server misconfigured
      break;
    case 'unknown':
      // Unexpected error - log and investigate
      break;
  }
}
```

## Programming Errors

Invalid configuration throws immediately:

```typescript
import { sendVote, CryptoError } from '@hytaleone/votifier';

try {
  await sendVote({
    server: { protocol: 'v1', host: '...', publicKey: 'invalid' },
    vote: { ... },
  });
} catch (error) {
  if (error instanceof CryptoError) {
    // Fix your configuration
  }
}
```

## Compatible Plugins

This library works with servers running:

- [NuVotifier](https://github.com/NuVotifier/NuVotifier) (Bukkit/Spigot/Paper) - V1 & V2
- [Votifier](https://dev.bukkit.org/projects/votifier) (Legacy Bukkit) - V1 only
- [VotifierPlus](https://www.spigotmc.org/resources/votifierplus.74040/) - V1 & V2
- Any Votifier-compatible plugin for Hytale servers

## Requirements

- Node.js >= 18

## License

MIT

## Related

- [@hytaleone/query](https://www.npmjs.com/package/@hytaleone/query) - Query Hytale and Minecraft servers

---

**[hytale.one](https://hytale.one/)** - Discover Hytale Servers
