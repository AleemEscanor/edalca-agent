# Dockerfile

# Use a Node.js base image with a specific version
# We use a slim variant for a smaller image size
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
# We do this first to leverage Docker's build cache
COPY package*.json ./

# Install npm dependencies
# We install dev dependencies as well for TypeScript compilation
# In a more optimized build, you would separate build and runtime dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the TypeScript code into JavaScript
RUN npm run build

# Expose the port that the Express server will listen on
EXPOSE 8080

# The command to run your application when the container starts
# This will execute the compiled JavaScript file
CMD [ "node", "dist/server.js" ]