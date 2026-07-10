import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({base:'./',plugins:[react(),VitePWA({registerType:'autoUpdate',manifest:{name:'Casa em Ordem — Finanças da Família',short_name:'Casa em Ordem',description:'Planejamento financeiro familiar privado',theme_color:'#18392f',background_color:'#f6f3ea',display:'standalone',start_url:'./',icons:[{src:'icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]}})]});
