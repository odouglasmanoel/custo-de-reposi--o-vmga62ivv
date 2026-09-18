/* Main entry point for the application - renders the root React component */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'
import { purgeObsoleteCaches } from './lib/cacheManager'

// Higiene de inicialização: remove caches obsoletos/legados em localStorage
purgeObsoleteCaches()

// @skip-protected: Do not remove. Required for React rendering.
createRoot(document.getElementById('root')!).render(<App />)
