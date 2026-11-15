FROM node:22-alpine
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=5174 TRUST_PROXY=1 DATA_DIR=/data UPLOADS_DIR=/data/uploads
# /data doit être un volume persistant (contenu, sauvegardes, mot de passe, fichiers envoyés).
VOLUME ["/data"]
EXPOSE 5174
USER node
CMD ["node", "backend/server.mjs"]
