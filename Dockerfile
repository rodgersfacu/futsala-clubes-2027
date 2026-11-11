# Imagen para desplegar en un servidor. Sirve en Fly.io, Railway, Render y cualquier
# lugar que acepte un Dockerfile.
#
# La aplicación no tiene dependencias, así que no hay nada que instalar: alcanza con
# Node y copiar el código.
FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY public ./public

# Los datos viven en un disco que sobrevive a cada despliegue. Sin esto, la base se
# borraría cada vez que se sube una versión nueva: es el error clásico con SQLite.
ENV FUTSALA_DATOS=/datos
VOLUME /datos

# El proxy del proveedor pone el HTTPS y reenvía acá.
ENV FUTSALA_PUBLICO=1
ENV FUTSALA_PROXY=1
ENV PORT=8080
EXPOSE 8080

# FUTSALA_SECRETO se configura como variable secreta en el proveedor, no acá.
CMD ["node", "server/index.js"]
