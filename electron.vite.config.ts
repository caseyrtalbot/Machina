import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@engine': resolve('src/renderer/src/engine')
      }
    },
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      include: [
        'react-dom/client',
        'zustand',
        'zustand/middleware',
        'gray-matter',
        'd3-force',
        'd3-quadtree',
        'd3-zoom',
        'd3-selection',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/markdown',
        '@tiptap/extension-task-list',
        '@tiptap/extension-task-item',
        '@tiptap/extension-link',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/lang-markdown',
        '@codemirror/theme-one-dark',
        '@codemirror/commands',
        '@codemirror/search',
        'xterm',
        '@xterm/addon-fit',
        '@xterm/addon-web-links',
        '@xterm/addon-search'
      ]
    }
  }
})
