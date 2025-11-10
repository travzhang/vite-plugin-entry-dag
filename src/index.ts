import fs from 'fs'
import path from 'path'
import type { Plugin } from 'vite'

interface Options {
  entries?: string[]   // 路由入口模块绝对路径数组
  outputFile?: string  // 输出文件名
  extensions?: string[] // 受支持的扩展名（如：['.ts','vue']），默认 js/jsx/ts/tsx/vue
}

interface DagNode {
  id: string
  order: number
}

type EdgeKind = 'static' | 'dynamic'

interface DagEdge {
  source: string
  target: string
  kind: EdgeKind
}

interface DagOutput {
  nodes: DagNode[]
  edges: DagEdge[]
  entries: string[]
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

      // DAG 结果
      const nodes: DagNode[] = []
      const edges: DagEdge[] = []
      const nodeIdToOrder = new Map<string, number>()
      const edgeKeySet = new Set<string>()
      const entryRelIds: string[] = []
      let orderCounter = 1

      const normalizeId = (id: string) => id.split('?')[0]
      const toRel = (absId: string) => {
        const clean = normalizeId(absId)
        const rel = path.relative(root, clean)
        return rel || clean
      }
      const normalizeExt = (ext: string) => {
        const e = ext.trim().toLowerCase()
        return e.startsWith('.') ? e : `.${e}`
      }
      const defaultExts = ['.js', '.jsx', '.ts', '.tsx', '.vue']
      const configuredExts = Array.isArray(options.extensions) && options.extensions.length > 0
        ? options.extensions.map(normalizeExt)
        : defaultExts
      const supportedExts = new Set(configuredExts)
      const hasSupportedExt = (id: string) => supportedExts.has(path.extname(normalizeId(id)).toLowerCase())
      const shouldSkip = (id: string) => {
        if (!id) return true
        if (id.includes('node_modules')) return true
        if (id.startsWith('\0')) return true // 虚拟模块
        return false
      }
      const ensureNode = (absId: string) => {
        const relId = toRel(absId)
        if (!nodeIdToOrder.has(relId)) {
          nodeIdToOrder.set(relId, orderCounter++)
          nodes.push({ id: relId, order: nodeIdToOrder.get(relId)! })
        }
        return relId
      }
      const addEdge = (fromRel: string, toRel: string, kind: EdgeKind) => {
        const key = `${fromRel}|${toRel}|${kind}`
        if (edgeKeySet.has(key)) return
        edgeKeySet.add(key)
        edges.push({ source: fromRel, target: toRel, kind })
      }

      for (const entry of entries) {
        if (!entry) continue
        const visited = new Set<string>() // 控制递归，避免死循环
        if (hasSupportedExt(entry)) {
          const entryRel = ensureNode(entry)
          entryRelIds.push(entryRel)
        }

        const traverse = (id: string) => {
          const info = this.getModuleInfo(id)
          const fromRel = toRel(id)
          // 仅当源节点是受支持类型时记录节点
          if (hasSupportedExt(id) && !nodeIdToOrder.has(fromRel)) {
            ensureNode(id)
          }

          if (!info) return

          // 静态 import
          for (const dep of info.importedIds) {
            if (shouldSkip(dep)) continue
            const depRel = toRel(dep)
            // 仅当两端均受支持类型时记录边
            if (hasSupportedExt(id) && hasSupportedExt(dep)) {
              if (!nodeIdToOrder.has(depRel)) ensureNode(dep)
              addEdge(fromRel, depRel, 'static')
            } else if (hasSupportedExt(dep) && !nodeIdToOrder.has(depRel)) {
              // 只记录目标节点，保持节点完整性（边需两端都支持才添加）
              ensureNode(dep)
            }
            if (!visited.has(dep)) {
              visited.add(dep)
              traverse.call(this, dep)
            }
          }
          // 动态 import
          for (const dep of info.dynamicallyImportedIds) {
            if (shouldSkip(dep)) continue
            const depRel = toRel(dep)
            if (hasSupportedExt(id) && hasSupportedExt(dep)) {
              if (!nodeIdToOrder.has(depRel)) ensureNode(dep)
              addEdge(fromRel, depRel, 'dynamic')
            } else if (hasSupportedExt(dep) && !nodeIdToOrder.has(depRel)) {
              ensureNode(dep)
            }
            if (!visited.has(dep)) {
              visited.add(dep)
              traverse.call(this, dep)
            }
          }
        }

        visited.add(entry)
        traverse.call(this, entry)

      }

      // 稳定输出：按发现顺序排序节点；边不强制排序
      nodes.sort((a, b) => a.order - b.order)
      const result: DagOutput = {
        nodes,
        edges,
        entries: entryRelIds
      }

      const outPath = path.resolve(root, config.build.outDir || 'dist', outputFile)
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
      console.log(`[vite-plugin-entry-dag] Generated ${outputFile}`)
    },
  }
}

