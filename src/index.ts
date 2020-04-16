import { createFilter,  } from '@rollup/pluginutils';

const chalk = require('chalk');
const md5 = require('md5');
const sass = require('sass');
const parseImports = require('parse-es6-imports');
const path = require('path');
const fs = require('fs');

interface Options {
    include: string[] | RegExp[];
    exclude: string[];
    includePaths: string[];
    sourceMap: boolean;
}

const defaultOptions: Options = {
    include: [/\.s?(a|c)ss$/],
    exclude: [],
    includePaths: [],
    sourceMap: null,
};

const stylesheets = new Map;
const hashLength = 8;

const transpile = (scss, key, options) => {
    let returnObj = {
        css: '',
        map: '',
        duration: 0,
        size: 0,
    };

    if (scss.length) {
        try {
            const result = sass.renderSync({
                file: key,
                outFile: 'build/css/standaloneSiteFooter.css',
                includePaths: options.includePaths,
                sourceMap: false,
            });

            returnObj = {
                ...returnObj,
                css: result.css ? result.css.toString() : '',
                map: result.map ? result.map.toString() : null,
                duration: result.stats.duration,
                size: Buffer.byteLength(result.css, 'utf8'),
            };

        } catch (e) {
            outputError(e, key);
        }
    }

    if (returnObj.css) {
        stylesheets.get(key).transpiled = returnObj.css;
    }
    
    return returnObj;
}

const loadCss = (key: string, options) => {
    let css = '';

    if (isCssFile(key)) {
        css = transpile(stylesheets.get(key).code, key, options).css;
    }

    if (stylesheets.has(key) && 'imports' in stylesheets.get(key)) {
        stylesheets.get(key).imports.forEach(i => {
            css += loadCss(i.path, options);
        });
    }

    return css;
}

const isCssFile = (filename: string) => {
    return filename.substr(-3) === 'css';
}

const outputError = (e, filepath = ''): void => {
    let message = '';
    let errorTitle = '';

    if (e.message.includes('expected')) {
        errorTitle = `SYNTAX ERROR`;
    } else if (e.message.includes('Can\'t find stylesheet')) {
        errorTitle = 'UNABLE TO FIND IMPORT';
    } else {
        errorTitle = 'ERROR';
    }

    message = `\n-- ${errorTitle} ${'-'.repeat(47 - errorTitle.length)}\n`;
    
    if (e.file || filepath) {
        message += `File: ${e.file !== 'stdin' ? e.file : filepath}\n`;
    }
    
    if (e.line) {
        message += `Line: ${e.line}` + (e.column ? `:${e.column}\n` : '');
    } else {
        message += `: `
    }

    message += `\n${e.message}\n`;

    if (e.message.includes('Can\'t find stylesheet')) {
        message += '\nHINT: Is your includePath correct?\n\n';
    }
    
    message += `${'-'.repeat(50)}\n`;

    console.log(chalk.bold.red(message));
}

const getJsImports = (code: string, absolutePath: string): [] => {
    const imports = parseImports(code).map(i => {
        const p = path.parse(i.fromModule);
        const ext = p.ext ? p.ext.substr(1) : 'js';

        if (['scss', 'sass', 'css', 'ts', 'js'].includes(ext)) {
            const importPath = getRealPath(p.dir, absolutePath)

            return {
                name: p.name,
                type: ext,
                path: `${importPath}/${p.name}.${ext}`,
            };
        }

        return false;
    }).filter(i => i);
    
    return imports;
}

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
    
    } else {
        realPath = `${process.cwd()}/node_modules/${filepath}`;
    }

    return fs.realpathSync(realPath);
};

const addModuleToTree = (name: string, imports, code: string) => {
    const realName = fs.realpathSync(name);
    if (!stylesheets.has(realName)) {
        stylesheets.set(realName, {
            code,
            imports,
        });
    }
}

const createTransform = (filter): Function => (code: string, id: string): string | void => {
    const imports = getJsImports(code, id);

    addModuleToTree(id, imports, code);

    if (!filter(id)) {
        return;
    }

    return '';
}

const watchChange = (id: string): void => {
    console.log('CHANGE');
}

const createGenerateBundle = (moduleOptions: Options) => function (options: Record<string, any>, bundle) {
    let sourceMap = '';
    let duration = 0;
    let size = 0;

    const transpileOptions = {
        ...moduleOptions,
    };

    if (!(moduleOptions === null) && options.sourcemap !== false) {
        transpileOptions.sourceMap = true;
    }
    const entrypoint = stylesheets.keys().next().value;
    const source = loadCss(entrypoint, transpileOptions);

    const bundleName = getBundleName(bundle) || path.basename(entrypoint, path.extname(entrypoint));
    const filename = buildFilename(bundleName, source, options);

    this.emitFile({
        source,
        type: 'asset',
        fileName: filename,
    });
    
    // this.emitFile({
    //     source: sourceMap,
    //     type: 'asset',
    //     fileName: `${filename}.map`,
    // });

    console.log(chalk.green(`${chalk.bold('Processed')}: ${bundleName}.css (${formatSize(size)}) in ${duration}ms\n`));

    return;
}

const buildFilename = (filename: string, contents: string, options: Record<string, any>): string => {
    const hash = md5(contents);
    console.log(hash);
    let newFilename = options.assetFileNames
        .replace(/\[ext\]/g, 'css')
        .replace(/\[extname\]/g, '.css')
        .replace(/\[name\]/g, filename)
        .replace(/\[hash\]/g, hash.substr(0, options.hashLength || hashLength));

    return newFilename;
}

const formatSize = (size: number): string => {
    const sizes: [number, string][] = [
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
}

const getBundleName = (bundle: Record<string, any>): string => {
    const key = Object.keys(bundle).pop();

    if (bundle[key].type === 'chunk') {
        return bundle[key].name;
    } else if (bundle[key].type === 'asset') {
        return bundle[key].fileName;
    }

    return '';
}

export default (options = {}) => {
    const moduleOptions = {
        ...defaultOptions,
        ...options
    };

    const filter = createFilter(moduleOptions.include, moduleOptions.exclude);

    return {
        name: 'scss-module-bundler',
        transform: createTransform(filter),
        watchChange,
        generateBundle: createGenerateBundle(moduleOptions),
    };
}
