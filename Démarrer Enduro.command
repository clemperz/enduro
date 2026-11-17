#!/bin/zsh
# Double-clique sur ce fichier pour lancer Enduro : il démarre le petit serveur
# local et ouvre l'application dans ton navigateur.
cd "$(dirname "$0")"
NODE="$(command -v node || echo /usr/local/bin/node)"
if [ ! -x "$NODE" ]; then
  echo "Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance."
  read -r "?Appuie sur Entrée pour fermer."
  exit 1
fi
exec "$NODE" server.js --open
