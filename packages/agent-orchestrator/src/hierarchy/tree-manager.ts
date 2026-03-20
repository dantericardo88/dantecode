import type { Checkpoint } from "@dantecode/runtime-spine";

export interface TreeNode {
  id: string;
  parentId?: string;
  children: string[];
  checkpoint?: Checkpoint;
}

/**
 * Manages the hierarchical tree of subagents and tasks.
 */
export class WaveTreeManager {
  private nodes = new Map<string, TreeNode>();

  addNode(id: string, parentId?: string): void {
    const node: TreeNode = {
      id,
      parentId,
      children: []
    };
    
    this.nodes.set(id, node);
    
    if (parentId) {
      const parent = this.nodes.get(parentId);
      if (parent) {
        parent.children.push(id);
      }
    }
  }

  getAncestors(id: string): string[] {
    const ancestors: string[] = [];
    let current = this.nodes.get(id);
    
    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = this.nodes.get(current.parentId);
    }
    
    return ancestors;
  }

  getDescendants(id: string): string[] {
    const descendants: string[] = [];
    const stack = [id];
    
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      const node = this.nodes.get(currentId);
      if (node) {
        descendants.push(...node.children);
        stack.push(...node.children);
      }
    }
    
    return descendants;
  }

  updateCheckpoint(id: string, checkpoint: Checkpoint): void {
    const node = this.nodes.get(id);
    if (node) {
      node.checkpoint = checkpoint;
    }
  }
}
