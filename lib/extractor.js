const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = ['.zip', '.rar', '.7z'];

function isSupportedArchive(filePath) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

// Everything below works off the file on disk rather than reading the archive
// into memory — mod archives run to multiple GB and buffering one whole would
// blow Node's array-buffer limit.

function sevenZip() {
  return require('7zip-min');
}

function unpackWith7z(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    sevenZip().unpack(archivePath, destDir, (err) => (err ? reject(err) : resolve()));
  });
}

async function extractRar(archivePath, destDir) {
  const { createExtractorFromFile } = require('node-unrar-js');
  const extractor = await createExtractorFromFile({
    filepath: archivePath,
    targetPath: destDir,
  });
  // Files are written to targetPath as the generator is consumed.
  const extracted = extractor.extract();
  for (const _file of extracted.files) {
    // iterate to drive the extraction
  }
}

async function extractArchive(archivePath, destDir) {
  const ext = path.extname(archivePath).toLowerCase();
  fs.mkdirSync(destDir, { recursive: true });

  if (ext === '.zip' || ext === '.7z') return unpackWith7z(archivePath, destDir);
  if (ext === '.rar') return extractRar(archivePath, destDir);

  throw new Error(
    `"${path.basename(archivePath)}" is not a supported archive. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`
  );
}

// Lists the file paths inside an archive without extracting it.
function listArchive(archivePath) {
  return new Promise((resolve, reject) => {
    sevenZip().list(archivePath, (err, entries) => {
      if (err) return reject(err);
      resolve(
        entries
          .filter((e) => e.attr === undefined || !e.attr.includes('D'))
          .map((e) => e.name.replace(/\\/g, '/'))
          .filter((name) => name.length > 0)
      );
    });
  });
}

// Builds a standard Deflate zip from a folder, streaming from disk.
function createZipFromFolder(srcDir, outZipPath) {
  return new Promise((resolve, reject) => {
    sevenZip().pack(path.join(srcDir, '*'), outZipPath, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

module.exports = {
  extractArchive,
  listArchive,
  createZipFromFolder,
  isSupportedArchive,
  SUPPORTED_EXTENSIONS,
};
