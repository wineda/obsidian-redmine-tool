// `npm version patch|minor|major` で package.json の version が上がったあとに呼ばれ、
// manifest.json と versions.json を同じ version に合わせる(Obsidian 公式サンプルと同じ仕組み)。
// これを main に push すると GitHub Actions がリリースを作り、BRAT が新しい版を取得できるようになる。
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
