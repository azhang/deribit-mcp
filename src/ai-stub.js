// agents/mcp's client lazily imports "ai" for a code path this server never
// takes. It is an optional peer we don't install, so alias it to this stub.
export function jsonSchema() {
  throw new Error('"ai" is not bundled in deribit-mcp');
}
