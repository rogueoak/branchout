import type { Server as HttpServer } from 'node:http';
import type { SocketServer } from '@branchout/protocol';
import { createWsServer } from '@branchout/protocol/ws';

/**
 * Attach the realtime endpoint to the HTTP server. For now it echoes `echo` messages straight
 * back - proof the transport works end to end. Game session handling grows here in later specs.
 */
export function attachGameSocket(server: HttpServer): SocketServer {
  return createWsServer(server, {
    onMessage: (connection, message) => {
      if (message.type === 'echo') {
        connection.send(message);
      }
    },
  });
}
