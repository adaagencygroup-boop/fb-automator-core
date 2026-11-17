FROM node:20-bookworm

WORKDIR /src

COPY package.json package-lock.json ./
COPY web-admin ./web-admin

WORKDIR /src/web-admin

ARG NEXT_PUBLIC_VPS_API_URL
ENV NEXT_PUBLIC_VPS_API_URL=${NEXT_PUBLIC_VPS_API_URL}

RUN npm ci && npm run build

EXPOSE 3010

CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3010"]
