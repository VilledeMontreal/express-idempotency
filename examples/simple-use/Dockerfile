FROM node:10

# Create app directory
WORKDIR /usr/src/app

# Copy the project
COPY . .

# Compile the library and link the library
RUN npm install && npm run compile && npm prune --production && npm link

# Installation of package to run the application
WORKDIR /usr/src/app/examples/simple-use

RUN npm link "express-idempotency" && npm install --production

EXPOSE 8080

# Run the application
WORKDIR /usr/src/app
CMD ["node", "./examples/simple-use/src/index.js"]

