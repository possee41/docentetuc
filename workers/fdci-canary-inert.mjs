// Step A only: no imports, bindings, authentication, D1 or background work.
export default {
  fetch() {
    return new Response("FDCI_CANARY_INERT", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
