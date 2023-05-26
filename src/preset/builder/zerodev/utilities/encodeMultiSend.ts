import { arrayify, solidityPack } from "ethers/lib/utils"
import { MultiSendCall } from "../types"

const encodeCall = (call: MultiSendCall): string => {
    const data = arrayify(call.data)
    const encoded = solidityPack(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [call.delegateCall ? 1 : 0, call.to, call.value || 0, data.length, data]
    )
    return encoded.slice(2)
  }
  
  export const encodeMultiSend = (calls: MultiSendCall[]): string => {
    return "0x" + calls.map((call) => encodeCall(call)).join("")
  }