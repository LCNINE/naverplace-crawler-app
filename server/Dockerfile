FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# Chromium 설치 (playwright install chromium)
RUN npx playwright install chromium

# 소스 복사 및 빌드
COPY . .
RUN npm run build

# 데이터 디렉토리 생성
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
