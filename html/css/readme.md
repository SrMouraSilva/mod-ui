## LESS compiler for MOD-UI's css

`main.css` is generated from `less/main.less` (which imports the other files in `less/`
and Bootstrap's LESS sources) with [Grunt](https://gruntjs.com/). Do not edit `main.css` by hand.

### Requirements

[Node.js](https://nodejs.org/) with its package manager `npm` are required to install the dependencies
which are included in package.json.

### Setup

From this folder (`html/css`):

```shell
npm install
```

This creates `node_modules/` (git-ignored), which is required: `main.less` imports
`../node_modules/bootstrap/less/*`.

### Usage

```shell
npm run build    # Compile less/main.less into main.css once
npm run watch    # Compile, then keep watching less/*.less and recompile on every change (Ctrl+C to stop)
                 # useful for development
```

Commit the regenerated `main.css` together with the `.less` change.

### Troubleshooting

- `EACCES` errors on `npm install`: npm is trying to write to a directory owned by root. Do not
  use `sudo`; fix the npm prefix/cache ownership instead
  (e.g. `sudo chown -R $USER ~/.npm`), or use a Node version manager such as `nvm`.
- `node: command not found` on old Debian/Ubuntu, where the binary is called `nodejs`:
  install the `nodejs-legacy` package or link it: `sudo ln -s /usr/bin/nodejs /usr/bin/node`.
- The dependencies in `package.json` are old (Grunt 0.4, `grunt-contrib-less` 1.x). If a very
  recent Node.js fails to run them, try an older LTS version.
