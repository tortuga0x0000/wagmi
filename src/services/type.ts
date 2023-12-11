export interface Service {
    start(): Promise<boolean>
}

export interface Data {
    id: string
    name: string
    symbol: string
}