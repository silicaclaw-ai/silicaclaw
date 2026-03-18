import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkJson(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  JSON.parse(raw);
}

function checkInlineScriptSyntax(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  assert(start >= 0 && end > start, `Missing inline script in ${htmlPath}`);
  const js = html.slice(start + '<script>'.length, end);
  new vm.Script(js, { filename: htmlPath });
}

class InMemoryLoopbackTransport {
  constructor() {
    this.handlers = new Set();
    this.started = false;
  }
  async start() { this.started = true; }
  async stop() { this.started = false; }
  async send(data) {
    if (!this.started) return;
    for (const h of this.handlers) {
      h(data, { remote_address: '127.0.0.1', remote_port: 0, transport: 'in-memory' });
    }
  }
  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  inject(data) {
    for (const h of this.handlers) {
      h(data, { remote_address: '192.168.1.88', remote_port: 44123, transport: 'in-memory' });
    }
  }
}

async function main() {
  const root = process.cwd();

  const criticalFiles = [
    'README.md',
    'ARCHITECTURE.md',
    'ROADMAP.md',
    'CHANGELOG.md',
    'VERSION',
    'apps/local-console/public/index.html',
    'apps/public-explorer/public/index.html',
    'data/cache.json',
    'data/profile.json',
    'data/identity.json',
    'data/logs.json',
  ];

  for (const rel of criticalFiles) {
    const abs = path.resolve(root, rel);
    assert(existsSync(abs), `Missing required file: ${rel}`);
  }

  // JSON file sanity
  checkJson(path.resolve(root, 'data/cache.json'));
  checkJson(path.resolve(root, 'data/logs.json'));
  checkJson(path.resolve(root, 'data/profile.json'));
  checkJson(path.resolve(root, 'data/identity.json'));

  // Browser script syntax sanity
  checkInlineScriptSyntax(path.resolve(root, 'apps/local-console/public/index.html'));
  checkInlineScriptSyntax(path.resolve(root, 'apps/public-explorer/public/index.html'));

  // Import built modules (requires npm run build)
  const core = await import(pathToFileURL(path.resolve(root, 'packages/core/dist/index.js')).href);
  const network = await import(pathToFileURL(path.resolve(root, 'packages/network/dist/index.js')).href);
  const localConsole = await import(
    pathToFileURL(path.resolve(root, 'apps/local-console/dist/apps/local-console/src/server.js')).href
  );

  // Core smoke: identity/profile/presence
  const identity = core.createIdentity();
  assert(identity.agent_id && identity.public_key && identity.private_key, 'Identity generation failed');

  const profile = core.signProfile({
    agent_id: identity.agent_id,
    display_name: 'demo-agent',
    bio: 'smoke',
    tags: ['ai', 'lan'],
    avatar_url: '',
    public_enabled: true,
  }, identity);
  assert(core.verifyProfile(profile, identity.public_key), 'Profile signature verification failed');

  const presence = core.signPresence(identity);
  assert(core.verifyPresence(presence, identity.public_key), 'Presence signature verification failed');

  const socialMessage = core.signSocialMessage({
    identity,
    message_id: 'smoke-social-msg-1',
    display_name: 'demo-agent',
    body: 'hello peers',
    created_at: Date.now(),
  });
  assert(core.verifySocialMessage(socialMessage), 'Social message signature verification failed');
  assert(
    core.verifySocialMessage({ ...socialMessage, body: 'tampered' }) === false,
    'Tampered social message should not verify'
  );

  // Core smoke: index + search + TTL
  let state = core.createEmptyDirectoryState();
  state = core.ingestProfileRecord(state, { type: 'profile', profile });
  state = core.ingestPresenceRecord(state, presence);
  const searchHit = core.searchDirectory(state, 'ai');
  assert(searchHit.length >= 1, 'Directory search failed for tag index');

  const cleaned = core.cleanupExpiredPresence(state, Date.now() + 999_999, 1000);
  assert(cleaned.removed >= 1, 'Presence cleanup failed');

  // Real preview adapter smoke with in-memory transport
  const transport = new InMemoryLoopbackTransport();
  const adapter = new network.RealNetworkAdapterPreview({
    transport,
    namespace: 'smoke.ns',
    maxMessageBytes: 4 * 1024,
    dedupeWindowMs: 60_000,
  });

  let receivedCount = 0;
  adapter.subscribe('profile', () => {
    receivedCount += 1;
  });

  await adapter.start();

  // Self publish should not deliver (self-message filter)
  await adapter.publish('profile', { hello: 'self' });

  // Inject remote envelope
  const codec = new network.JsonMessageEnvelopeCodec();
  const remoteEnvelope = {
    version: 1,
    message_id: 'msg-1',
    topic: 'smoke.ns:profile',
    source_peer_id: 'remote-peer-1',
    timestamp: Date.now(),
    payload: { hello: 'remote' },
  };
  transport.inject(codec.encode(remoteEnvelope));
  transport.inject(codec.encode(remoteEnvelope)); // duplicate

  // Namespace mismatch should be dropped
  transport.inject(codec.encode({ ...remoteEnvelope, message_id: 'msg-2', topic: 'other.ns:profile' }));

  // Malformed should be dropped
  transport.inject(Buffer.from('{not-json'));

  await new Promise((r) => setTimeout(r, 20));

  const diagnostics = adapter.getDiagnostics();
  assert(receivedCount === 1, 'Dedup/self filter behavior unexpected');
  assert(diagnostics.stats.dropped_duplicate >= 1, 'Expected duplicate drop counter');
  assert(diagnostics.stats.dropped_namespace_mismatch >= 1, 'Expected namespace mismatch drop counter');
  assert(diagnostics.stats.dropped_malformed >= 1, 'Expected malformed drop counter');

  await adapter.stop();

  // OpenClaw bridge service smoke
  process.env.NETWORK_ADAPTER = 'mock';
  const tempStorageRoot = mkdtempSync(path.join(tmpdir(), 'silicaclaw-functional-check-'));
  mkdirSync(path.join(tempStorageRoot, 'data'), { recursive: true });
  const service = new localConsole.LocalNodeService({
    workspaceRoot: root,
    storageRoot: tempStorageRoot,
  });
  await service.start();
  try {
    const bridgeStatus = service.getOpenClawBridgeStatus();
    assert(typeof bridgeStatus.agent_id === 'string', 'Bridge status missing agent_id');

    const bridgeProfile = service.getOpenClawBridgeProfile();
    assert(bridgeProfile?.profile, 'Bridge profile payload missing profile');

    const currentProfile = service.getProfile();
    assert(currentProfile, 'Current profile missing');
    await service.updateProfile({
      display_name: currentProfile.display_name || 'bridge-smoke',
      bio: currentProfile.bio || 'bridge smoke',
      tags: Array.isArray(currentProfile.tags) ? currentProfile.tags : ['openclaw'],
      avatar_url: currentProfile.avatar_url || '',
      public_enabled: true,
    });

    const sendResult = await service.sendSocialMessage('bridge smoke message');
    assert(sendResult.sent === true, 'Bridge message send failed');

    const messageList = service.getSocialMessages(5);
    const items = Array.isArray(messageList?.items) ? messageList.items : [];
    assert(items.some((item) => item.body === 'bridge smoke message'), 'Bridge message not visible in bridge list');
  } finally {
    await service.stop();
    rmSync(tempStorageRoot, { recursive: true, force: true });
  }

  console.log('Functional check passed: core + network preview + bridge service smoke + UI script syntax + data sanity');
}

main().catch((error) => {
  console.error('Functional check failed:', error.message);
  process.exit(1);
});
