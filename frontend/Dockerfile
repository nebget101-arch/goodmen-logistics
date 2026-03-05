FROM node:20-alpine

WORKDIR /usr/src/app

# Install system dependencies (if needed)
RUN apk add --no-cache bash

COPY frontend ./frontend

WORKDIR /usr/src/app/frontend

RUN npm install

ENV NODE_ENV=development

EXPOSE 4200

# Bind Angular dev server to all interfaces so Docker can expose it
CMD ["npm", "run", "start", "--", "--host", "0.0.0.0", "--port", "4200"]

