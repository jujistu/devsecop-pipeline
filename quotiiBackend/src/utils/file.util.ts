const fs = require('fs');

export function renameWithExt(file: any) {
  const ext = file.mimetype.split('/')[1]; 

  fs.rename(`${file.path}`, `${file.path}.${ext}`, () => {});
}
