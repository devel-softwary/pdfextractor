FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "const base='http://127.0.0.1:'+(process.env.PORT||3000); Promise.all(['/healthz','/readyz'].map((p)=>fetch(base+p).then((r)=>{if(!r.ok)throw new Error(String(r.status));}))).then(()=>process.exit(0)).catch(()=>process.exit(1));"]
CMD ["npm", "start"]
