'use strict';

var pluginutils = require('@rollup/pluginutils');

const chalk = require('chalk');
const md5 = require('md5');
const sass = require('sass');
const parseImports = require('parse-es6-imports');
const path = require('path');
const fs = require('fs');
const Concat = require('concat-with-sourcemaps');
const escapeRegex = require('escape-string-regexp');
const stripbom = require('strip-bom');
const defaultOptions = {
    exclude: [],
    include: [/\.s?(a|c)ss$/],
    includePaths: [],
    outDir: '',
    outputStyle: "compressed",
    sourceMap: null,
    sourceRoot: [],
    pathResolver: (url) => { return url; }
};
const stylesheets = new Map;
const hashLength = 8;
const transpiledStylesheets = new Map;
let skipNext = false;
const transpile = (scss, filepath, options) => {
    let returnObj = {
        css: '',
        map: '',
        duration: 0,
        size: 0,
        file: '',
    };
    if (scss.length) {
        try {
            let sourceRoots = [];
            if (typeof options.sourceRoot === 'string') {
                sourceRoots.push(options.sourceRoot);
            }
            else if (Array.isArray(options.sourceRoot)) {
                sourceRoots = options.sourceRoot;
            }
            const outFile = `${options.outDir}${sourceRoots.reduce((acc, cur) => acc.replace(cur, ''), filepath)}`.replace(/s(a|c)ss/, 'css');
            let renderOptions = {
                file: filepath,
                includePaths: options.includePaths,
                outFile: outFile,
                outputStyle: options.outputStyle,
                importer: (url, file) => {
                    let resolvedUrl = options.pathResolver(url);
                    if (resolvedUrl === undefined) {
                        resolvedUrl = url;
                    }
                    return {
                        file: resolvedUrl
                    };
                }
            };
            if (options.sourceMap) {
                renderOptions = {
                    ...renderOptions,
                    sourceMap: `${outFile.replace(/s(a|c)ss/, 'css')}.map`,
                    sourceMapRoot: options.outDir,
                    sourceMapContents: true,
                };
            }
            ;
            const result = sass.renderSync(renderOptions);
            returnObj = {
                ...returnObj,
                file: outFile,
                css: result.css ? stripbom(result.css.toString()) : '',
                map: options.sourceMap && result.map ? stripbom(result.map.toString().replace(new RegExp(escapeRegex(options.sourceRoot[0]), 'g'), options.outDir)) : null,
                duration: result.stats.duration,
                size: Buffer.byteLength(result.css, 'utf8'),
            };
            transpiledStylesheets.set(filepath, returnObj);
        }
        catch (e) {
            outputError(e, filepath);
        }
    }
    return returnObj;
};
const getRealKey = (key) => {
    const escapedKey = key.replace('/', path.sep);
    if (!fs.existsSync(escapedKey) && escapedKey.substr(-3) === '.js' && fs.existsSync(escapedKey.replace(/\.js$/, '.ts'))) {
        return escapedKey.replace(/\.js$/, '.ts');
    }
    else {
        return escapedKey;
    }
};
const loadCss = (key, options, includedFiles = new Set) => {
    let result = [];
    let realKey = getRealKey(key);
    includedFiles.add(realKey);
    if (isCssFile(realKey) && !transpiledStylesheets.has(realKey)) {
        result.push(transpile(stylesheets.get(realKey).code, realKey, options));
    }
    if (stylesheets.has(realKey) && 'imports' in stylesheets.get(realKey)) {
        stylesheets.get(realKey).imports.forEach(i => {
            const importKey = getRealKey(i.path);
            if (includedFiles.has(importKey)) {
                return;
            }
            const css = transpiledStylesheets.has(importKey) ? [transpiledStylesheets.get(importKey)] : loadCss(i.path, options, includedFiles);
            result = [
                ...result,
                ...css,
            ];
        });
    }
    return result;
};
const isCssFile = (filename) => {
    return filename.substr(-3) === 'css';
};
const outputError = (e, filepath = '') => {
    let message = '';
    let errorTitle = '';
    if (e.message.includes('expected')) {
        errorTitle = `SYNTAX ERROR`;
    }
    else if (e.message.includes('Can\'t find stylesheet')) {
        errorTitle = 'UNABLE TO FIND IMPORT';
    }
    else {
        errorTitle = 'ERROR';
    }
    message = `\n-- ${errorTitle} ${'-'.repeat(47 - errorTitle.length)}\n`;
    if (e.file || filepath) {
        message += `File: ${e.file !== 'stdin' ? e.file : filepath}\n`;
    }
    if (e.line) {
        message += `Line: ${e.line}` + (e.column ? `:${e.column}\n` : '');
    }
    else {
        message += `: `;
    }
    message += `\n${e.message}\n`;
    if (e.message.includes('Can\'t find stylesheet')) {
        message += '\nHINT: Is your includePath correct?\n\n';
    }
    message += `${'-'.repeat(50)}\n`;
    console.log(chalk.bold.red(message));
};
const getJsImports = (code, absolutePath, pathResolver) => {
    // Needed to fix TypeScript injecting code above imports
    const importStart = code.indexOf('import');
    if (importStart >= 0) {
        const imports = parseImports(code.substr(code.indexOf('import')))
            .filter(i => !hasBom(i.fromModule))
            .map(i => {
            const p = path.parse(i.fromModule);
            const ext = p.ext ? p.ext.substr(1) : 'js';
            if (['scss', 'sass', 'css', 'ts', 'js'].includes(ext)) {
                let filepath = pathResolver(p.dir);
                if (filepath === undefined) {
                    filepath = p.dir;
                }
                const importPath = getRealPath(filepath, absolutePath);
                return {
                    name: p.name,
                    type: ext,
                    path: `${importPath}/${p.name}.${ext}`,
                };
            }
            return false;
        })
            .filter(i => i);
        return imports;
    }
    return [];
};
/**
 * Assumptions are being made here:
 * - If the path starts with a '.', then we assume it's relative to the refPath and will be resolved
 * - Otherwise assume it's located in the node_modules directory of the process's directory
 *
 * TO DO: Walk directory tree and find closest node_modules directory
 */
const getRealPath = (filepath, refPath) => {
    let realPath = '';
    if (filepath[0] === '.') {
        realPath = path.resolve(path.dirname(refPath), filepath);
    }
    else {
        realPath = `${process.cwd()}/node_modules/${filepath}`;
    }
    return fs.realpathSync(realPath);
};
const addModuleToTree = (name, imports, code) => {
    if (name.includes('\0')) {
        return;
    }
    const realName = fs.realpathSync(name);
    if (!stylesheets.has(realName)) {
        stylesheets.set(realName, {
            code,
            imports,
        });
    }
};
const createTransform = (filter, pathResolver) => (code, id) => {
    if (!skipNext) {
        const imports = getJsImports(code, id, pathResolver);
        addModuleToTree(id, imports, code);
    }
    if (!filter(id)) {
        return;
    }
    return '';
};
const watchChange = (id) => {
    console.log('CHANGE');
};
const createGenerateBundle = (moduleOptions) => function (options, bundle) {
    if (skipNext) {
        return;
    }
    const transpileOptions = {
        ...moduleOptions,
    };
    if (!(moduleOptions === null) && options.sourcemap !== false) {
        transpileOptions.sourceMap = true;
    }
    const entrypoint = stylesheets.keys().next().value;
    const transpileResult = loadCss(entrypoint, transpileOptions);
    const duration = transpileResult.reduce((acc, cur) => acc += cur.duration, 0);
    const size = transpileResult.reduce((acc, cur) => acc += cur.size, 0);
    const bundleName = getBundleName(bundle) || path.basename(entrypoint, path.extname(entrypoint));
    if (size > 0) {
        const concatenator = new Concat(transpileOptions.sourceMap, `${moduleOptions.outDir}/${bundleName}.css`, '\n');
        transpileResult.forEach(result => {
            concatenator.add(result.file, result.css, transpileOptions.sourceMap ? result.map : '');
        });
        const filename = buildFilename(bundleName, concatenator.content, options);
        this.emitFile({
            source: concatenator.content,
            type: 'asset',
            fileName: filename,
        });
        if (transpileOptions.sourceMap) {
            this.emitFile({
                source: concatenator.sourceMap,
                type: 'asset',
                fileName: `${filename}.map`,
            });
        }
        console.log(chalk.green(`created ${chalk.bold(`${bundleName}.css (${formatSize(size)})`)} in ${chalk.bold(`${duration}ms`)}`));
    }
    else {
        this.warn(`Skipped empty file: ${bundleName}.css`);
    }
    skipNext = true;
    return;
};
const buildFilename = (filename, contents, options) => {
    let newFilename = options.assetFileNames
        .replace(/\[ext\]/g, 'css')
        .replace(/\[extname\]/g, '.css')
        .replace(/\[name\]/g, filename);
    if (options.assetFileNames.includes('[hash]')) {
        newFilename = newFilename.replace(/\[hash\]/g, md5(contents).substr(0, options.hashLength || hashLength));
    }
    return newFilename;
};
const formatSize = (size) => {
    const sizes = [
        [9, 'GB'],
        [6, 'MB'],
        [3, 'KB'],
        [0, 'B'],
    ];
    for (let i = 0; i < sizes.length; i++) {
        const [power, label] = sizes[i];
        if (size > Math.pow(10, power)) {
            const formattedSize = (size / Math.pow(10, power)).toLocaleString('en-US', { maximumFractionDigits: 1 });
            return `${formattedSize}${label}`;
        }
    }
    return '';
};
const getBundleName = (bundle) => {
    const key = Object.keys(bundle).pop();
    if (bundle[key].type === 'chunk') {
        return bundle[key].name;
    }
    else if (bundle[key].type === 'asset') {
        return bundle[key].fileName;
    }
    return '';
};
const hasBom = (module) => {
    if (!module.search(/\0/)) {
        return true;
    }
    return false;
};
var index = (options = {}) => {
    const moduleOptions = {
        ...defaultOptions,
        ...options
    };
    const filter = pluginutils.createFilter(moduleOptions.include, moduleOptions.exclude);
    return {
        name: 'scss-module-bundler',
        transform: createTransform(filter, moduleOptions.pathResolver),
        watchChange,
        generateBundle: createGenerateBundle(moduleOptions),
        buildStart: () => {
            transpiledStylesheets.clear();
            stylesheets.clear();
            skipNext = false;
        },
    };
};

module.exports = index;
