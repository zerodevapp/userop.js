import { BigNumberish, BytesLike } from "ethers"

export interface Call {
    to: string
    data: BytesLike
    value?: BigNumberish
}
  
export interface DelegateCall {
    to: string
    data: string
}

export interface MultiSendCall extends Call {
    delegateCall?: boolean
}