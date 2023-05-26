import { BigNumber, BigNumberish, BytesLike, Contract, ethers } from "ethers";
import { UserOperationBuilder } from "../../../builder";
import {
  EOASignature,
  estimateUserOperationGas,
  getGasPrice,
} from "../../middleware";
import {
  EntryPoint,
  EntryPoint__factory,
  KernelFactory,
  KernelFactory__factory,
  Kernel,
  Kernel__factory,
} from "../../../typechain";
import { UserOperationMiddlewareFn } from "../../../types";
import { DEFAULT_MULTISEND_ADDRESS, DUMMY_PAYMASTER_AND_DATA, DUMMY_SIGNATURE } from "./constants";


export class KernelAccount extends UserOperationBuilder {
  private address: string;
  private provider: ethers.providers.JsonRpcProvider;
  private entryPoint: EntryPoint;
  private factory: KernelFactory;
  private initCode: string;
  private multiSendAddress: string;
  proxy: Kernel;

  private constructor(
    address: string,
    ERC4337NodeRpc: string,
    entryPoint: string,
    factoryAddress: string,
    multiSendAddress = DEFAULT_MULTISEND_ADDRESS
  ) {
    super();
    this.address = address
    this.provider = new ethers.providers.JsonRpcProvider(ERC4337NodeRpc);
    this.entryPoint = EntryPoint__factory.connect(entryPoint, this.provider);
    this.factory = KernelFactory__factory.connect(
      factoryAddress,
      this.provider
    );
    this.initCode = "0x";
    this.proxy = Kernel__factory.connect(
      ethers.constants.AddressZero,
      this.provider
    );
    this.multiSendAddress = multiSendAddress
  }

  private resolveAccount: UserOperationMiddlewareFn = async (ctx) => {
    this.proxy
    const senderAddressCode = await this.provider.getCode(this.proxy.address)
    const isDeployed = senderAddressCode.length > 2
    let nonce = BigNumber.from(0)
    if (isDeployed) nonce = await this.proxy["getNonce()"]()
    ctx.op.nonce = nonce 
    ctx.op.initCode = ctx.op.nonce.eq(0) ? this.initCode : "0x";
  };

  public static async init(
    address: string,
    ERC4337NodeRpc: string,
    entryPoint: string,
    factoryAddress: string,
    index = 0,
    paymasterMiddleware?: UserOperationMiddlewareFn,
  ): Promise<KernelAccount> {
    const instance = new KernelAccount(
      address,
      ERC4337NodeRpc,
      entryPoint,
      factoryAddress
    );

    try {
      instance.initCode = ethers.utils.hexConcat([
        instance.factory.address,
        instance.factory.interface.encodeFunctionData("createAccount", [
          address,
          index
        ]),
      ]);
      await instance.entryPoint.callStatic.getSenderAddress(instance.initCode);

      throw new Error("getSenderAddress: unexpected result");
    } catch (error: any) {
      const addr = error?.errorArgs?.sender;
      if (!addr) throw error;

      instance.proxy = Kernel__factory.connect(addr, instance.provider);
    }

    const base = instance
      .useDefaults({
        sender: instance.proxy.address,
        paymasterAndData: DUMMY_PAYMASTER_AND_DATA,
        signature: DUMMY_SIGNATURE,
      })
      .useMiddleware(instance.resolveAccount)
      .useMiddleware(getGasPrice(instance.provider));

    const withPM = paymasterMiddleware
      ? base.useMiddleware(paymasterMiddleware)
      : base.useMiddleware(estimateUserOperationGas(instance.provider));

    return withPM
  }

  execute(to: string, value: BigNumberish, data: BytesLike) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("executeAndRevert", [to, value, data, 0])
    );
  }

  executeDelegate(to: string, value: BigNumberish, data: BytesLike) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("executeAndRevert", [to, value, data, 1])
    );
  }

  executeBatch(to: Array<string>, data: Array<BytesLike>) {
    const multiSend = new Contract(this.multiSendAddress, [
      'function multiSend(bytes memory transactions)',
    ])

    const multiSendCalldata = multiSend.interface.encodeFunctionData(
      'multiSend',
      [data]
    )
    return this.executeDelegate(multiSend.address, 0, multiSendCalldata)
  }
}
