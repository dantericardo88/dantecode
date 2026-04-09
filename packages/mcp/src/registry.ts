// Community MCP Server Registry
// Launch registry for 100+ third-party tools

export class MCPRegistry {
  private servers: Map<string, MCPServer> = new Map();

  register(server: MCPServer) {
    this.servers.set(server.name, server);
  }

  get(name: string) {
    return this.servers.get(name);
  }

  list() {
    return Array.from(this.servers.values());
  }

  async publish(server: MCPServer) {
    // Submit to registry
    this.register(server);
    console.log(`Published ${server.name}`);
  }
}

interface MCPServer {
  name: string;
  tools: string[];
}