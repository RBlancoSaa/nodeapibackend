import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async () => {
  return new Response(JSON.stringify({
    success: true,
    message: "Edge function draait. IMAP-check blijft in Node.js backend."
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
