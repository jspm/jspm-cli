export declare type OrderingValue = string | [string, OrderingArray];
export interface OrderingArray extends Array<OrderingValue> {
}
export interface ConfigValue {
    value: any[] | number | boolean | string;
}
export interface ObjectProperty {
    key: string;
    value: ConfigObject | ConfigValue;
}
export declare type ConfigObject = ObjectProperty[];
export declare type ValueType = 'array' | 'number' | 'boolean' | 'string';
export default class ConfigFile {
    fileName: string;
    private ordering;
    private style;
    protected timestamp: number;
    private properties;
    protected changeEvents: ((configMember: string[]) => void | boolean)[];
    protected changed: boolean;
    private originalName;
    private _unlock;
    protected locked: boolean;
    constructor(fileName: string, ordering: OrderingArray);
    rename(newName: string): void;
    protected getValue(memberArray: string[], type?: ValueType): any;
    protected getProperties(memberArray: string[], createIfUndefined?: boolean): ObjectProperty[];
    protected getObject(memberArray?: any[], nested?: boolean, createIfUndefined?: boolean): {};
    protected has(memberArray: string[]): boolean;
    protected remove(memberArray: string[], clearParentsIfMadeEmpty?: boolean): boolean;
    protected clearIfEmpty(memberArray: string[]): void;
    protected setValue(memberArray: string[], value: any, overwrite?: boolean): void;
    protected setProperties(memberArray: string[], properties: ConfigObject, clearIfEmpty?: boolean, keepOrder?: boolean, extend?: boolean, overwrite?: boolean): void;
    protected orderFirst(memberArray: string[]): void;
    protected orderLast(memberArray: string[]): void;
    protected setObject(memberArray: string[], obj: any, clearIfEmpty?: boolean, keepOrder?: boolean): void;
    protected extendObject(memberArray: string[] | any, obj?: any, keepOrder?: boolean): void;
    protected prependObject(memberArray: string[] | any, obj?: any, keepOrder?: boolean): void;
    protected serialize(obj: any): string;
    protected deserialize(source: string): any;
    onChange(memberArray: string[]): void;
    protected lock(symlink?: boolean): any;
    protected unlock(): void;
    exists(): boolean;
    protected read(): void;
    protected write(): boolean;
}
export interface jsonStyle {
    tab: string;
    newline: string;
    trailingNewline: boolean;
    quote: string;
}
export declare function readJSONStyled(filePath: string): Promise<{
    json: any;
    style: jsonStyle;
}>;
export declare function writeJSONStyled(filePath: string, json: any, style: jsonStyle): Promise<void>;
export declare const defaultStyle: {
    tab: string;
    newline: any;
    trailingNewline: boolean;
    quote: string;
};
export declare function detectStyle(string: string): jsonStyle;
export declare function serializeJson(json: any, style: jsonStyle): string;
