// Test edge only: never attempt a second response after a streamed response starts.
export function upstreamFailure(response) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(503);
  response.end();
}
