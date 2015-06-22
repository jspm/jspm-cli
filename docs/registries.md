* [Customizing Registries](#customizing-registries)
* [Creating new Registries](#creating-new-registries)
* [Auto-configuring Registries](#auto-configuring-registries)
* [Creating a private jspm registry](#creating-a-private-registry)

### Customizing Registries

All registries have configuration options for setting their server URIs, auth credentials and settings.

#### Private GitHub

To support private GitHub, simply authenticate with your private GitHub account:

```
  jspm registry config github
```

```
Would you like to set up your GitHub credentials? [yes]: 
     If using two-factor authentication or to avoid using your password you can generate an access token at https://github.com/settings/applications.

Enter your GitHub username: username
Enter your GitHub password or access token: 
Would you like to test these credentials? [yes]: 
```

This will enable private repo installs.

#### Private npm

Similarly for npm, we can authenticate and set a custom registry path through the configuration:

```
  jspm registry config npm
```

When available, the npm registry endpoint will automatically pull authentication details from the local `.npmrc` file,
and will not need to store this separately.

```
npm registry [https://registry.npmjs.org]: 
Currently reading credentials from npmrc, configure custom authentication? [no]:
```

To skip all prompts run `jspm registry config npm -y` to automate the confirmation responses (this applies to all jspm operations).

### Creating New Registries

You may wish to create your own custom registries, such as a custom private `npm` or `github` enterprise setup.

> Note that it is not advisable to create an registry with a different name to `npm` or `github` if it is a mirror, as the goal is for registry names to be canonical and universal. **Only use this option when your custom registry doesn't duplicate public packages on npm or GitHub.**

#### Separate private npm

This can be setup with:

```
  jspm registry create myregistry jspm-npm
```

We now have an `npm` registry based on a custom registry and authentication which can be used as expected:

```
  jspm install myregistry:package
```

#### GitHub enterprise support

It is possible to create a GitHub enterprise support with:

```
  jspm registry create mycompany jspm-github
Are you setting up a GitHub Enterprise endpoint? [yes]: 
Enter the hostname of your GitHub Enterprise server: mycompany.com
Would you like to set up your GitHub credentials? [yes]: 
```

Note that GitHub enterprise support has not been comprehensively tested, as we've had to rely on feedback and PRs from GitHub enterprise users. If there are any issues at all please post an issue and we'll work to fix these.

#### Custom Registries

Third-party registries are listed at https://github.com/jspm/jspm-cli/wiki/Community-Projects#registry-endpoints.

If you wish to create a custom registry for another type of package registry, this can be done by implementing the [Registry API](https://github.com/jspm/jspm-cli/wiki/Registry-API).

The custom registry can be installed through npm:

```
  npm install custom-registry
  jspm registry create myregistry custom-registry
```

> If using locally-scoped jspm, then the above install is local. If using global jspm, then the above install is global.

If your registry endpoint is general enough that it would be of value to other users please do share it for inclusion in the third-party registry endpoint list.

### Auto-configuring Registries

When running on automated testing servers or for setting up other developers quickly with a registry environment, it is useful to have a single script that can be run to automate registry configuration.

The `jspm registry export` command will export the list of commands needed to recreate exactly that registry through configuration calls to jspm:

```
  jspm registry export github
jspm config registries.github.remote https://github.jspm.io
jspm config registries.github.auth JSPM_GITHUB_AUTH_TOKEN
jspm config registries.github.maxRepoSize 100
jspm config registries.github.handler jspm-github
```
> The JSPM_GITHUB_AUTH_TOKEN above is an unencrypted Base64 encoding of the GitHub username and *password* or *access token* (separated by a `:`, e.g. `username:token`). The access token needs the `public_repo` scope.

These commands can then be run to easily regenerate the registry configuration.

For npm, you may wish to automate the loading of config from npmrc. This can be done with a `-y` flag script:

```
  jspm registry config npm -y
```

Which will just respond with defaults to all questions asked during registry install.

#### Travis CI

To configure registries through TravisCI, use the [Travis CLI tool](https://github.com/travis-ci/travis.rb#installation) to encrypt the **[JSPM_GITHUB_AUTH_TOKEN](#auto-configuring-registries)** from the `jspm registry export`.

```
travis encrypt 'JSPM_GITHUB_AUTH_TOKEN=[JSPM_GITHUB_AUTH_TOKEN]'
```

Then include it in Travis.yml:

```yml
env:
  global:
  - secure: [ENCRYPTED_STRING]

before_install:
- npm install -g jspm
- jspm config registries.github.auth $JSPM_GITHUB_AUTH_TOKEN
```

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
