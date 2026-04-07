# ============================================================
# frontend/Dockerfile — React + Vite (dev)
# ============================================================

FROM node:20-alpine

WORKDIR /app

# Installer les dépendances d'abord (cache Docker)
COPY package*.json ./
RUN npm install

# Copier le reste du code
COPY . .

EXPOSE 5173

# Vite en mode dev avec host 0.0.0.0 pour Docker
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]