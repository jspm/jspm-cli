import { Project } from '../api';
import { PackageTarget, PackageConfig, DepType } from './package';
export interface InstallOptions {
    verify?: boolean;
    edge?: boolean;
    lock?: boolean;
    latest?: boolean;
    dedupe?: boolean;
    optional?: boolean;
    reset?: boolean;
    exact?: boolean;
}
export interface Install {
    name: string;
    parent: string | void;
    target: PackageTarget | string;
    type: DepType;
    override?: PackageConfig | void;
}
export declare class Installer {
    binFolderChecked: boolean;
    private opts;
    private project;
    private config;
    private registryManager;
    private installTree;
    private installs;
    private sourceInstalls;
    offline: boolean;
    preferOffline: boolean;
    private secondaryRanges;
    private primaryRanges;
    private jspmPackageInstallStateCache;
    private globalPackagesPath;
    private changed;
    private busy;
    private updatePrimaryRanges;
    constructor(project: Project);
    dispose(): void;
    ensureNotBusy(): void;
    update(selectors: string[], opts: InstallOptions): Promise<boolean>;
    link(pkg: string, source: string, opts: InstallOptions): Promise<boolean>;
    checkout(selectors: string[]): Promise<void>;
    uninstall(names: string[]): Promise<boolean>;
    install(installs: Install[], opts: InstallOptions): Promise<boolean>;
    private getOverride(pkg, cut?);
    private cutOverride(pkg);
    private setOverride(pkgTarget, override);
    private packageInstall(install);
    private sourceInstall(resolvedPkg, source, override, deprecated);
    private createBins(config, resolvedPkgName);
    private resourceInstall(install);
    private installDependencies(registry, config, resolvedPkgName, preloadedDepNames?);
    private setResolution(install, target, resolution, source);
    private setResolution(install, target, resolution, source);
    getPackagePath(name: string): string;
    private createCheckoutPrompt(resolvedPkgName);
    private readCheckedOutConfig(resolvedPkgName, override, linked?);
    private upgradePackagesTo(upgradePkg);
    private setPackageToHash(pkgName, hash);
    private setPackageToLinked(pkgName, linkPath);
    private packageExists(pkgName);
    private isPackageCheckedOut(pkgName);
    private getPackageInstallState(pkgName);
    private ensureInstallRanges(exactPkg?);
    clean(save?: boolean): Promise<boolean>;
}
