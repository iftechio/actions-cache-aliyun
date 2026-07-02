"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTempDirectory = createTempDirectory;
exports.getArchiveFileSizeInBytes = getArchiveFileSizeInBytes;
exports.resolvePaths = resolvePaths;
exports.unlinkFile = unlinkFile;
exports.getCompressionMethod = getCompressionMethod;
exports.getCacheFileName = getCacheFileName;
exports.getGnuTarPathOnWindows = getGnuTarPathOnWindows;
exports.isZstdInstalled = isZstdInstalled;
exports.assertDefined = assertDefined;
exports.isGhes = isGhes;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const glob = __importStar(require("@actions/glob"));
const io = __importStar(require("@actions/io"));
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const semver = __importStar(require("semver"));
const util = __importStar(require("util"));
const constants_1 = require("./constants");
// From https://github.com/actions/toolkit/blob/main/packages/tool-cache/src/tool-cache.ts#L23
async function createTempDirectory() {
    const IS_WINDOWS = process.platform === 'win32';
    let tempDirectory = process.env['RUNNER_TEMP'] || '';
    if (!tempDirectory) {
        let baseLocation;
        if (IS_WINDOWS) {
            // On Windows use the USERPROFILE env variable
            baseLocation = process.env['USERPROFILE'] || 'C:\\';
        }
        else {
            if (process.platform === 'darwin') {
                baseLocation = '/Users';
            }
            else {
                baseLocation = '/home';
            }
        }
        tempDirectory = path.join(baseLocation, 'runner', 'temp');
    }
    const dest = path.join(tempDirectory, crypto.randomUUID());
    await io.mkdirP(dest);
    return dest;
}
function getArchiveFileSizeInBytes(filePath) {
    return fs.statSync(filePath).size;
}
async function resolvePaths(patterns) {
    const paths = [];
    const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
    const globber = await glob.create(patterns.join('\n'), {
        implicitDescendants: false
    });
    for await (const file of globber.globGenerator()) {
        const relativeFile = path
            .relative(workspace, file)
            .replace(new RegExp(`\\${path.sep}`, 'g'), '/');
        core.debug(`Matched: ${relativeFile}`);
        // Paths are made relative so the tar entries are all relative to the root of the workspace.
        if (relativeFile === '') {
            // path.relative returns empty string if workspace and file are equal
            paths.push('.');
        }
        else {
            paths.push(`${relativeFile}`);
        }
    }
    return paths;
}
async function unlinkFile(filePath) {
    return util.promisify(fs.unlink)(filePath);
}
async function getVersion(app, additionalArgs = []) {
    let versionOutput = '';
    additionalArgs.push('--version');
    core.debug(`Checking ${app} ${additionalArgs.join(' ')}`);
    try {
        await exec.exec(`${app}`, additionalArgs, {
            ignoreReturnCode: true,
            silent: true,
            listeners: {
                stdout: (data) => (versionOutput += data.toString()),
                stderr: (data) => (versionOutput += data.toString())
            }
        });
    }
    catch (err) {
        core.debug(err.message);
    }
    versionOutput = versionOutput.trim();
    core.debug(versionOutput);
    return versionOutput;
}
// Use zstandard if possible to maximize cache performance
async function getCompressionMethod() {
    const versionOutput = await getVersion('zstd', ['--quiet']);
    const version = semver.clean(versionOutput);
    core.debug(`zstd version: ${version}`);
    if (versionOutput === '') {
        return constants_1.CompressionMethod.Gzip;
    }
    else {
        return constants_1.CompressionMethod.ZstdWithoutLong;
    }
}
function getCacheFileName(compressionMethod) {
    return compressionMethod === constants_1.CompressionMethod.Gzip
        ? constants_1.CacheFilename.Gzip
        : constants_1.CacheFilename.Zstd;
}
async function getGnuTarPathOnWindows() {
    if (fs.existsSync(constants_1.GnuTarPathOnWindows)) {
        return constants_1.GnuTarPathOnWindows;
    }
    const versionOutput = await getVersion('tar');
    return versionOutput.toLowerCase().includes('gnu tar') ? io.which('tar') : '';
}
async function isZstdInstalled() {
    try {
        await io.which('zstd', true);
        return true;
    }
    catch (error) {
        return false;
    }
}
function assertDefined(name, value) {
    if (value === undefined) {
        throw Error(`Expected ${name} but value was undefiend`);
    }
    return value;
}
function isGhes() {
    const ghUrl = new URL(process.env['GITHUB_SERVER_URL'] || 'https://github.com');
    return ghUrl.hostname.toUpperCase() !== 'GITHUB.COM';
}
//# sourceMappingURL=cacheUtils.js.map