/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace libs are shipped as CommonJS; transpile so Next can bundle them
  // for both server and client components.
  transpilePackages: ["@stabil/types", "@stabil/scoring"],
};

export default nextConfig;
