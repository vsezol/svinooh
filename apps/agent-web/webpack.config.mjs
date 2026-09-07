import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  // The standalone page entry. The federated surface ('./mount') is declared
  // on the plugin below and does not need an entry of its own.
  entry: { main: './src/index.ts' },
  output: {
    path: path.resolve(here, 'dist'),
    // The bundle is served from the agent service, not from a fixed host —
    // 'auto' derives the public path from the loading script tag.
    publicPath: 'auto',
    clean: true,
  },
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        // The workspace UI lib ships TSX sources, not compiled output — it
        // must go through the same loader as this app.
        include: [path.resolve(here, 'src'), path.resolve(here, '../../libs/ui/src')],
        loader: 'esbuild-loader',
        options: {
          loader: 'tsx',
          target: 'es2020',
          jsx: 'automatic',
        },
      },
      {
        test: /\.css$/,
        // style-loader (not extracted CSS): the embedded widget must inject
        // its styles into whatever page mounts it.
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    // Which agent API the standalone page talks to. A static bundle has no
    // server to read the environment at run time, so the address is baked in;
    // empty falls back to this page's own origin (a local build, or a host
    // that serves both from one place).
    new webpack.DefinePlugin({
      'process.env.AGENT_API_URL': JSON.stringify(process.env.AGENT_API_URL || ''),
    }),
    new webpack.container.ModuleFederationPlugin({
      name: 'svinooh_agent',
      filename: 'remoteEntry.js',
      // 'var' keeps the container consumable from a plain script tag: the
      // Turbopack host cannot do build-time federation and attaches at runtime.
      library: { type: 'var', name: 'svinooh_agent' },
      exposes: {
        './mount': './src/mount',
      },
      // Every React entry point this bundle actually imports is shared, not
      // just the package roots: webpack matches share keys by request, so
      // 'react-dom/client' left out would ship a second renderer beside the
      // host's — one React, two react-doms, and the bugs that come with it.
      // createPortal comes from 'react-dom', createRoot from 'react-dom/client'.
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.0' },
        'react-dom/client': { singleton: true, requiredVersion: '^19.2.0' },
      },
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
      chunks: ['main'],
      // Absolute, because every route serves this same page (/demo included)
      // and a relative src would resolve against the route's path. This is
      // only the tag in the HTML: webpack's own publicPath stays 'auto',
      // which is what lets a federation host load the chunks from this
      // service's origin rather than its own.
      publicPath: '/',
    }),
  ],
};
