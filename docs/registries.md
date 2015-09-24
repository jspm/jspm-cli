* [Customizing Registries](#customizing-registries)
* [Auto-configuring Registries](#auto-configuring-registries)
* [Creating a private jspm registry](#creating-a-private-jspm-registry)
* [Creating new Registries](#creating-new-registries)

### Customizing Registries

All registries have configuration options for setting their server URIs, auth credentials and settings.

#### Private GitHub

To support private GitHub, simply authenticate with your private GitHub account:

```
  jspm registry config github
```

```
Would you like to set up your GitHub credentials? [yes]: 
     If using two-factor authentication or to avoid using your password you can generate an access token at https://github.com/settings/tokens.

Enter your GitHub username: username
Enter your GitHub password or access token: 
Would you like to test these credentials? [yes]: 
```

This will enable private repo installs.

#### Private npm

When available, the npm registry endpoint will automatically pull authentication details from the local `.npmrc` file, so that private npm scopes and registries should be configured automatically.

To set up manual credentials, use:

```
  jspm registry config npm
```

### Auto-configuring Registries

All registries can export their exact configurations including authentication via `jspm registry export` which can be included in an init script in such an environment:

```
  jspm registry export github
jspm config registries.github.remote https://github.jspm.io
jspm config registries.github.auth JSPM_GITHUB_AUTH_TOKEN
jspm config registries.github.maxRepoSize 100
jspm config registries.github.handler jspm-github
```

#### GitHub Authentication Environment Variable

GitHub is rate-limited by IP so that when running automated installs for testing or other workflows, it is necessary to configure authentication, otherwise a `GitHub rate limit reached.` error message will likely be displayed.

To make authentication easier, an environment variable `JSPM_GITHUB_AUTH_TOKEN` can be set on the automated server, containing exactly the value of `registries.github.auth` when running `jspm registry export github`, after configuring GitHub authentication manually via `jspm registry config github`.

> This `JSPM_GITHUB_AUTH_TOKEN` is an unencrypted Base64 encoding of the GitHub username and *password* or *access token* separated by a `:`, e.g. `username:token`.

### Creating a private jspm Registry

You may wish to run your own version of the jspm registry instead of using the publicly maintained default. Running your own registry is particularly useful if you want to create short names to private packages and test lots of overrides.

```
  git clone git@github.com:jspm/registry jspm-registry
  jspm registry config jspm
  Enter the registry repo path [git@github.com:jspm/registry]: path/to/jspm-registry/.git
```

Now when you install or update a module your private registry will be used instead of the public registry.

You can also host the private registry as a shared internal git repo allowing for a company-wide registry.

It is advisable to periodically maintain upstream updates from the jspm registry into this fork.

### Creating New Registries

#### Custom Registries

Third-party registries are listed at https://github.com/jspm/jspm-cli/wiki/Third-Party-Resources#registries.

If you wish to create a custom registry for another type of package registry, this can be done by implementing the [Registry API](registry-api.md).

The custom registry can be installed through npm:

```
  npm install custom-registry
  jspm registry create myregistry custom-registry
```

> If using locally-scoped jspm, then the above install is local. If using global jspm, then the above install is global.

If your registry endpoint is general enough that it would be of value to other users please do share it for inclusion in the third-party registry endpoint list.

#### GitHub enterprise support

It is possible to create a GitHub enterprise support with:

```
  jspm registry create mycompany jspm-github
Are you setting up a GitHub Enterprise endpoint? [yes]: 
Enter the hostname of your GitHub Enterprise server: mycompany.com
Would you like to set up your GitHub credentials? [yes]: 
```

Note that GitHub enterprise support has not been comprehensively tested, as we've had to rely on feedback and PRs from GitHub enterprise users. If there are any issues at all please post an issue and we'll work to fix these.

#### Separate private npm

> **Note that it is not advisable to create an registry with a different name to `npm` or `github` if it is a mirror, as the goal is for registry names to be canonical and universal.**

This can be setup with:

```
  jspm registry create myregistry jspm-npm
```

We now have an `npm` registry based on a custom registry and authentication which can be used as expected:

```
  jspm install myregistry:package
```
