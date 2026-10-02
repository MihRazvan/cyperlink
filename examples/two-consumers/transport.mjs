// Compatibility entry point: reusable signing, journaling and exact-wire recovery live in the client package.
export { SignedInstructionSender as DemoTransport, sleep } from '../../packages/local-client/src/transaction-sender.mjs';
