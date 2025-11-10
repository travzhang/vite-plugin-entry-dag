import fs from 'fs'
import path from 'path'
import type { Plugin } from 'vite'

interface ModuleNode {
  id: string
  deps: ModuleNode[]
  order: number
}

interface Options {
  entries?: string[]   // 路由入口模块绝对路径数组
  outputFile?: string  // 输出文件名
}


export default function (options: Options = {}): Plugin {
  const { entries = [], outputFile = 'vite-plugin-entry-dag.json' } = options
  let config: any
  return {
    name: 'vite-plugin-entry-dag',
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },
    generateBundle(_, bundle) {
      if (!config) return
      const root = config.root || process.cwd()
      const result: Record<string, ModuleNode> = {}
      for (const entry of entries) {
        const visited = new Set<string>()
        let counter = 1  // 全局递增编号
        function collectDeps(id: string): ModuleNode | null {
          if (!id || visited.has(id) || id.includes('node_modules')) return null
          visited.add(id)
          const info = this.getModuleInfo(id)
          if (!info) return { id, deps: [], order: counter++ }
          const depsNodes: ModuleNode[] = []
          // 递归静态 import
          info.importedIds.forEach((dep) => {
            const node = collectDeps.call(this, dep)
            if (node) depsNodes.push(node)
          })
          // 动态 import，顺序按发现顺序编号
          info.dynamicallyImportedIds.forEach((dep) => {
            const node = collectDeps.call(this, dep)
            if (node) depsNodes.push(node)
          })
          return { id, deps: depsNodes, order: counter++ }
        }

        const tree = collectDeps.call(this, entry)
        if (tree) {
          result[path.relative(root, entry)] = tree
        }

      }
      const outPath = path.resolve(root, config.build.outDir || 'dist', outputFile)
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
      console.log(`[vite-plugin-entry-dag] Generated ${outputFile}`)
    },
  }
}

