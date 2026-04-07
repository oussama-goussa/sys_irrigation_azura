# ============================================================
# Dockerfile — Version backend
# Projet Azura Irrigation — GOUSSA Oussama
# ============================================================

# Image de base Python 3.11
FROM python:3.11-slim

# Dossier de travail dans le conteneur
WORKDIR /app

# Installer dépendances système
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copier requirements en premier
# (Docker met en cache cette etape si requirements.txt ne change pas)
COPY requirements.txt .

# Installer les librairies Python
RUN pip install --no-cache-dir -r requirements.txt

# Copier tout le code du backend
COPY . .

# Rendre start.sh exécutable
RUN chmod +x start.sh
 
EXPOSE 8000
 
# Démarrage avec migration automatique
CMD ["./start.sh"]
