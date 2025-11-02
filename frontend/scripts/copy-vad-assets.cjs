// scripts/copy-vad-assets.cjs
const fs = require("fs");
const path = require("path");

const sourceVad = "node_modules/@ricky0123/vad-web/dist";
const sourceOrt = "node_modules/onnxruntime-web/dist";
const dest = "public";

if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

const copyFiles = (srcDir, pattern) => {
  const files = fs.readdirSync(srcDir).filter((f) => pattern.test(f));
  files.forEach((file) => {
    fs.copyFileSync(path.join(srcDir, file), path.join(dest, file));
    console.log(`✅ Copied: ${file}`);
  });
};

// Copy Silero model
copyFiles(sourceVad, /\.onnx$/);

// Copy ONNX runtime .wasm + .mjs
copyFiles(sourceOrt, /\.(wasm|mjs)$/);

console.log("✅ All VAD + ONNXRuntime assets copied successfully!");
