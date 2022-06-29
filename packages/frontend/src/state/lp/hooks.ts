import { FeeAmount, nearestUsableTick, TickMath, tickToPrice, TICK_SPACINGS } from '@uniswap/v3-sdk'

import { fromTokenAmount } from '@utils/calculations'
import { useAtom, useAtomValue } from 'jotai'
import { addressesAtom, isWethToken0Atom } from '../positions/atoms'
import BigNumber from 'bignumber.js'
import { BIG_ZERO, INDEX_SCALE, OSQUEETH_DECIMALS, UNI_POOL_FEES } from '@constants/index'
import { controllerContractAtom, controllerHelperHelperContractAtom, nftManagerContractAtom } from '../contracts/atoms'
import useAppCallback from '@hooks/useAppCallback'
import { addressAtom } from '../wallet/atoms'
import { normFactorAtom } from '../controller/atoms'
import { Price, Token } from '@uniswap/sdk-core'
import { useHandleTransaction } from '../wallet/hooks'
import { squeethPriceeAtom, squeethTokenAtom, wethPriceAtom, wethTokenAtom } from '../squeethPool/atoms'
import { ethers } from 'ethers'
import { useGetSellQuote } from '../squeethPool/hooks'
import { useUpdateAtom } from 'jotai/utils'
import { lowerTickAtom, upperTickAtom } from './atoms'
import { useCallback, useMemo } from 'react'
import { useGetDebtAmount, useGetTwapEthPrice, useGetTwapSqueethPrice, useGetVault } from '../controller/hooks'
import { useFirstValidVault } from '../positions/hooks'

/*** CONSTANTS ***/
const one = new BigNumber(10).pow(18)
export enum Bound {
  LOWER = 'LOWER',
  UPPER = 'UPPER',
}

/*** ACTIONS ***/

// Close position with flashloan
export const useClosePosition = () => {
  const address = useAtomValue(addressAtom)
  const controllerHelperContract = useAtomValue(controllerHelperHelperContractAtom)
  const controllerContract = useAtomValue(controllerContractAtom)
  const handleTransaction = useHandleTransaction()
  const getTwapSqueethPrice = useGetTwapSqueethPrice()
  const getDebtAmount = useGetDebtAmount()
  const getVault = useGetVault()
  const getPosition = useGetPosition()
  const closePosition = useAppCallback(async (vaultId: number, onTxConfirmed?: () => void) => {
    const vaultBefore = await getVault(vaultId)
    console.log(vaultBefore)
    const uniTokenId = vaultBefore?.NFTCollateralId 
    const position = await getPosition(uniTokenId)

    if (
      !controllerContract ||
      !controllerHelperContract ||
      !address ||
      !position ||
      !vaultBefore ||
      !vaultBefore.shortAmount
    )
      return

    const shortAmount = fromTokenAmount(vaultBefore.shortAmount, OSQUEETH_DECIMALS)
    const debtInEth = await getDebtAmount(shortAmount)
    const collateralToFlashloan = debtInEth.multipliedBy(1.5)
    const slippage = new BigNumber(3).multipliedBy(new BigNumber(10).pow(16))
    const squeethPrice = await getTwapSqueethPrice()
    const limitPriceEthPerPowerPerp = squeethPrice.multipliedBy(one.minus(slippage))

    // const positionBefore = await positionManager.methods.positions(uniTokenId)
    const flashloanCloseVaultLpNftParam = {
      vaultId: vaultId.toFixed(0),
      tokenId: uniTokenId,
      liquidity: position.liquidity,
      liquidityPercentage: fromTokenAmount(1, 18).toFixed(0),
      wPowerPerpAmountToBurn: shortAmount.toFixed(0),
      collateralToFlashloan: collateralToFlashloan.toFixed(0),
      collateralToWithdraw: 0,
      limitPriceEthPerPowerPerp: limitPriceEthPerPowerPerp.toFixed(0),
      amount0Min: 0,
      amount1Min: 0,
      poolFee: 3000,
      burnExactRemoved: true,
    }

    return handleTransaction(
      await controllerHelperContract.methods.flashloanCloseVaultLpNft(flashloanCloseVaultLpNftParam).send({
        from: address,
      }),
      onTxConfirmed,
    )
  }, [address, controllerHelperContract, controllerContract])
  return closePosition
}

// Opening a mint and LP position and depositing
export const useOpenPositionDeposit = () => {
  const { squeethPool } = useAtomValue(addressesAtom)
  const address = useAtomValue(addressAtom)
  const contract = useAtomValue(controllerHelperHelperContractAtom)
  const handleTransaction = useHandleTransaction()
  const getTwapSqueethPrice = useGetTwapSqueethPrice()
  const getDebtAmount = useGetDebtAmount()
  const openPositionDeposit = useAppCallback(
    async (squeethToMint: BigNumber, lowerTickInput: number, upperTickInput: number, vaultID: number, onTxConfirmed?: () => void) => {
      const squeethPrice = await getTwapSqueethPrice()
      const mintWSqueethAmount = fromTokenAmount(squeethToMint, OSQUEETH_DECIMALS)
      const ethDebt = await getDebtAmount(mintWSqueethAmount)
      // Do we want to hardcode a 150% collateralization ratio?
      console.log('squeeth price', squeethPrice.toString())
      const collateralToMint = ethDebt.multipliedBy(3).div(2)
      const collateralToLp = mintWSqueethAmount.multipliedBy(squeethPrice)

      const lowerTick = nearestUsableTick(lowerTickInput, 3000)
      const upperTick = nearestUsableTick(upperTickInput, 3000)

      const flashloanWMintDepositNftParams = {
        wPowerPerpPool: squeethPool,
        vaultId: vaultID,
        wPowerPerpAmount: mintWSqueethAmount.toFixed(0),
        collateralToDeposit: collateralToMint.toFixed(0),
        collateralToFlashloan: collateralToMint.toFixed(0),
        collateralToLp: collateralToLp.toFixed(0),
        collateralToWithdraw: 0,
        amount0Min: 0,
        amount1Min: 0,
        lowerTick: lowerTick,
        upperTick: upperTick,
      }

      console.log('flashloanWMintDepositNftParams from hooks', flashloanWMintDepositNftParams)
      if (!contract || !address) return null

      return handleTransaction(
        contract.methods.flashloanWMintLpDepositNft(flashloanWMintDepositNftParams).send({
          from: address,
          value: collateralToLp.toFixed(0),
        }),
        onTxConfirmed,
      )
    },
    [address, squeethPool, contract],
  )
  return openPositionDeposit
}

// Collect fees
export const useCollectFees = () => {
  const address = useAtomValue(addressAtom)
  const controllerHelperContract = useAtomValue(controllerHelperHelperContractAtom)
  const { controllerHelper } = useAtomValue(addressesAtom)
  const controllerContract = useAtomValue(controllerContractAtom)
  const handleTransaction = useHandleTransaction()
  const positionManager = useAtomValue(nftManagerContractAtom)
  const getDebtAmount = useGetDebtAmount()
  const getVault = useGetVault()
  const collectFees = useAppCallback(async (vaultId: number, onTxConfirmed?: () => void) => {
    const vaultBefore = await getVault(vaultId)
    console.log(vaultBefore)
    const uniTokenId = vaultBefore?.NFTCollateralId    
    
    if (
      !controllerContract ||
      !controllerHelperContract ||
      !address ||
      !positionManager ||
      !vaultBefore ||
      !vaultBefore.shortAmount
    )
      return

    const shortAmount = fromTokenAmount(vaultBefore.shortAmount, OSQUEETH_DECIMALS)
    console.log("shortAmount", shortAmount)
    const debtInEth = await getDebtAmount(shortAmount)
    console.log("debtInEth", debtInEth)
    const collateralToFlashloan = debtInEth.multipliedBy(1.5)
    console.log("collateralToFlashloan", collateralToFlashloan)
    const amount0Max = new BigNumber(2).multipliedBy(new BigNumber(10).pow(18)).minus(1).toFixed(0)
    const amount1Max = new BigNumber(2).multipliedBy(new BigNumber(10).pow(18)).minus(1).toFixed(0)
    console.log([uniTokenId, amount0Max, amount1Max])
    // console.log(amount0Max.toFixed(0))
    const abiCoder = new ethers.utils.AbiCoder()
    // const rebalanceLpInVaultParams = [
    //   {
    //     rebalanceLpInVaultType: new BigNumber(6).toFixed(0),
    //     // CollectFees
    //     data: abiCoder.encode(['uint256', 'uint128', 'uint128'], [Number(uniTokenId), amount0Max, amount1Max]),
    //   },
    //   {
    //     rebalanceLpInVaultType: new BigNumber(7).toFixed(0),
    //     // DepositExistingNftParams
    //     data: abiCoder.encode(["uint256"], [Number(uniTokenId)])
    //   }
    // ]
    // console.log(rebalanceLpInVaultParams)
    // await controllerContract.methods.updateOperator(vaultId, controllerHelper)

    const rebalanceLpInVaultParams = [
      {
       rebalanceLpInVaultType: new BigNumber(6).toFixed(0),
       data: '0x00000000000000000000000000000000000000000000000000000000000311220000000000000000000000000000000000000000000000001bc16d674ec7ffff0000000000000000000000000000000000000000000000001bc16d674ec7ffff'
      },
      {
       rebalanceLpInVaultType: new BigNumber(7).toFixed(0),
       data: '0x0000000000000000000000000000000000000000000000000000000000031122'
      }
    ]
    console.log("hi")
    return handleTransaction(
      await controllerHelperContract.methods
        .rebalanceLpInVault("673", '0', rebalanceLpInVaultParams)
        .send({
          from: address,
        }),
      onTxConfirmed,
    )
  }, [])
  return collectFees
}

export function getTickToPrice(baseToken?: Token, quoteToken?: Token, tick?: number): Price<Token, Token> | undefined {
  if (!baseToken || !quoteToken || typeof tick !== 'number') {
    return undefined
  }
  return tickToPrice(baseToken, quoteToken, tick)
}

// Rebalance via vault
export const useRebalanceVault = () => {
  const address = useAtomValue(addressAtom)
  const controllerHelperContract = useAtomValue(controllerHelperHelperContractAtom)
  const { controllerHelper, squeethPool } = useAtomValue(addressesAtom)
  const controllerContract = useAtomValue(controllerContractAtom)
  const handleTransaction = useHandleTransaction()
  const positionManager = useAtomValue(nftManagerContractAtom)
  const isWethToken0 = useAtomValue(isWethToken0Atom)
  const getSellQuote = useGetSellQuote()
  const getDebtAmount = useGetDebtAmount()
  const rebalanceVault = useAppCallback(
    async (vaultId: BigNumber, lowerTickInput: number, upperTickInput: number, onTxConfirmed?: () => void) => {
      if (!controllerContract || !controllerHelperContract || !address || !positionManager) return
      const uniTokenId = (await controllerContract?.methods.vaults(vaultId)).NftCollateralId
      const positionBefore = await positionManager.methods.positions(uniTokenId)
      const vaultBefore = await controllerContract?.methods.vaults(vaultId)
      const debtInEth = await getDebtAmount(vaultBefore.shortAmount)
      const collateralToFlashloan = debtInEth.multipliedBy(1.5)
      const tokenIndex = await positionManager.methods.totalSupply()
      const tokenId = await positionManager.methods.tokenByIndex(tokenIndex.sub(1))
      const amount0Min = new BigNumber(0)
      const amount1Min = new BigNumber(0)

      const lowerTick = nearestUsableTick(lowerTickInput, 3000)
      const upperTick = nearestUsableTick(upperTickInput, 3000)

      // Get current LPpositions
      const [amount0, amount1] = await positionManager.methods.decreaseLiquidity({
        tokenId: tokenId,
        liquidity: positionBefore.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: Math.floor(Date.now() / 1000 + 1800),
      })
      const wPowerPerpAmountInLPBefore = isWethToken0 ? amount1 : amount0
      const wethAmountInLPBefore = isWethToken0 ? amount0 : amount1

      // Estimate proceeds from liquidating squeeth in LP
      const ethAmountOutFromSwap = getSellQuote(wPowerPerpAmountInLPBefore)

      // Estimate of new LP with 0.01 weth safety margin
      const wethAmountToLP = wethAmountInLPBefore.add(ethAmountOutFromSwap)

      const abiCoder = new ethers.utils.AbiCoder()
      const rebalanceLpInVaultParams = [
        {
          // Liquidate LP
          rebalanceLpInVaultType: new BigNumber(1), // DecreaseLpLiquidity:
          // DecreaseLpLiquidityParams: [tokenId, liquidity, liquidityPercentage, amount0Min, amount1Min]
          data: abiCoder.encode(
            ['uint256', 'uint256', 'uint256', 'uint128', 'uint128'],
            [
              tokenId,
              positionBefore.liquidity,
              new BigNumber(100).multipliedBy(new BigNumber(10).pow(16)).toFixed(0),
              new BigNumber(0).toFixed(0),
              new BigNumber(0).toFixed(0),
            ],
          ),
        },
        {
          // Deposit into vault and mint
          rebalanceLpInVaultType: new BigNumber(2).toString(), // DepositIntoVault
          // DepsositIntoVault: [wPowerPerpToMint, collateralToDeposit]
          data: abiCoder.encode(['uint256', 'uint256'], [wPowerPerpAmountInLPBefore, wethAmountInLPBefore]),
        },
        {
          // Withdraw from vault
          rebalanceLpInVaultType: new BigNumber(3), // WithdrawFromVault
          // withdrawFromVault: [wPowerPerpToBurn, collateralToWithdraw, burnExactRemoved ]
          data: abiCoder.encode(
            ['uint256', 'uint256', 'bool'],
            [wPowerPerpAmountInLPBefore, wethAmountInLPBefore, false],
          ),
        },
        {
          // Mint new LP
          rebalanceLpInVaultType: new BigNumber(4).toString(), // MintNewLP
          // lpWPowerPerpPool: [recipient, wPowerPerpPool, vaultId, wPowerPerpAmount, collateralToDeposit, collateralToLP, amount0Min, amount1Min, lowerTick, upperTick ]
          data: abiCoder.encode(
            ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'int24', 'int24'],
            [
              controllerHelper,
              squeethPool,
              vaultId,
              new BigNumber(0).toFixed(0),
              new BigNumber(0).toFixed(0),
              wethAmountToLP,
              amount0Min,
              amount1Min,
              lowerTick,
              upperTick,
            ],
          ),
        },
      ]

      await controllerContract.methods.updateOperator(vaultId, controllerHelper)
      return handleTransaction(
        await controllerHelperContract.methods
          .rebalanceLpInVault(vaultId, collateralToFlashloan, rebalanceLpInVaultParams)
          .send({
            from: address,
          }),
        onTxConfirmed,
      )
    },
    [],
  )
  return rebalanceVault
}

// Rebalance via general swap
export const useRebalanceGeneralSwap = () => {
  const address = useAtomValue(addressAtom)
  const controllerHelperContract = useAtomValue(controllerHelperHelperContractAtom)
  const { controllerHelper, weth, oSqueeth, squeethPool } = useAtomValue(addressesAtom)
  const controllerContract = useAtomValue(controllerContractAtom)
  const handleTransaction = useHandleTransaction()
  const positionManager = useAtomValue(nftManagerContractAtom)
  const isWethToken0 = useAtomValue(isWethToken0Atom)
  const getSellQuote = useGetSellQuote()
  const getDebtAmount = useGetDebtAmount()
  const rebalanceGeneralSwap = useAppCallback(
    async (vaultId: BigNumber, lowerTickInput: number, upperTickInput: number, onTxConfirmed?: () => void) => {
      if (!controllerContract || !controllerHelperContract || !address || !positionManager) return
      const uniTokenId = (await controllerContract?.methods.vaults(vaultId)).NftCollateralId
      const positionBefore = await positionManager.methods.positions(uniTokenId)
      const vaultBefore = await controllerContract?.methods.vaults(vaultId)
      const debtInEth = await getDebtAmount(vaultBefore.shortAmount)
      const collateralToFlashloan = debtInEth.multipliedBy(1.5)
      const tokenIndex = await positionManager.methods.totalSupply()
      const tokenId = await positionManager.methods.tokenByIndex(tokenIndex.sub(1))
      const amount0Min = new BigNumber(0)
      const amount1Min = new BigNumber(0)

      const lowerTick = nearestUsableTick(lowerTickInput, 3000)
      const upperTick = nearestUsableTick(upperTickInput, 3000)

      // Get current LPpositions
      const [amount0, amount1] = await positionManager.methods.decreaseLiquidity({
        tokenId: tokenId,
        liquidity: positionBefore.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: Math.floor(Date.now() / 1000 + 1800),
      })
      const wPowerPerpAmountInLPBefore = isWethToken0 ? amount1 : amount0
      const wethAmountInLPBefore = isWethToken0 ? amount0 : amount1

      // Estimate proceeds from liquidating squeeth in LP
      const ethAmountOutFromSwap = getSellQuote(wPowerPerpAmountInLPBefore)

      // Estimate of new LP with 0.01 weth safety margin
      const wethAmountToLP = wethAmountInLPBefore.add(ethAmountOutFromSwap)

      const abiCoder = new ethers.utils.AbiCoder()
      const rebalanceLpInVaultParams = [
        {
          // Liquidate LP
          rebalanceLpInVaultType: new BigNumber(1), // DecreaseLpLiquidity:
          // DecreaseLpLiquidityParams: [tokenId, liquidity, liquidityPercentage, amount0Min, amount1Min]
          data: abiCoder.encode(
            ['uint256', 'uint256', 'uint256', 'uint128', 'uint128'],
            [
              tokenId,
              positionBefore.liquidity,
              new BigNumber(100).multipliedBy(new BigNumber(10).pow(16)).toFixed(0),
              new BigNumber(0).toFixed(0),
              new BigNumber(0).toFixed(0),
            ],
          ),
        },
        {
          // Sell all oSQTH for ETH
          rebalanceLpInVaultType: new BigNumber(5), // GeneralSwap:
          // GeneralSwap: [tokenIn, tokenOut, amountIn, limitPrice]
          data: abiCoder.encode(
            ['address', 'address', 'uint256', 'uint256', 'uint24'],
            [oSqueeth, weth, wPowerPerpAmountInLPBefore, new BigNumber(0).toFixed(0), 3000],
          ),
        },
        {
          // Mint new LP
          rebalanceLpInVaultType: new BigNumber(4).toString(), // MintNewLP
          // lpWPowerPerpPool: [recipient, wPowerPerpPool, vaultId, wPowerPerpAmount, collateralToDeposit, collateralToLP, amount0Min, amount1Min, lowerTick, upperTick ]
          data: abiCoder.encode(
            ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'int24', 'int24'],
            [
              controllerHelper,
              squeethPool,
              vaultId,
              new BigNumber(0).toFixed(0),
              new BigNumber(0).toFixed(0),
              wethAmountToLP,
              amount0Min,
              amount1Min,
              lowerTick,
              upperTick,
            ],
          ),
        },
      ]

      await controllerContract.methods.updateOperator(vaultId, controllerHelper)
      return handleTransaction(
        await controllerHelperContract.methods
          .rebalanceLpInVault(vaultId, collateralToFlashloan, rebalanceLpInVaultParams)
          .send({
            from: address,
          }),
        onTxConfirmed,
      )
    },
    [],
  )
  return rebalanceGeneralSwap
}

/*** GETTERS ***/
// Get next tick price
export const useGetNextTickPrice = () => {
  const setLowerTick = useUpdateAtom(lowerTickAtom)
  const setUpperTick = useUpdateAtom(upperTickAtom)
  const lowerTick = useAtomValue(lowerTickAtom)
  const upperTick = useAtomValue(upperTickAtom)
  const isWethToken0 = useAtomValue(isWethToken0Atom)
  const squeethToken = useAtomValue(squeethTokenAtom)
  const wethToken = useAtomValue(wethTokenAtom)
  const getNextTickPrice = useAppCallback(async (getHigherTick: boolean, isUpperTick: boolean) => {
    const atLimit = useIsTickAtLimit(3000, lowerTick.toNumber(), upperTick.toNumber())

    if (isUpperTick) {
      const newUpperTick = !getHigherTick
        ? upperTick.minus(TICK_SPACINGS[3000])
        : !atLimit
        ? upperTick.plus(TICK_SPACINGS[3000])
        : null
      if (newUpperTick) {
        setUpperTick(newUpperTick)
        return isWethToken0
          ? tickToPrice(wethToken!, squeethToken!, newUpperTick.toNumber())
          : tickToPrice(squeethToken!, wethToken!, newUpperTick.toNumber())
      }
    } else {
      const newLowerTick = getHigherTick
        ? lowerTick.plus(TICK_SPACINGS[3000])
        : !atLimit
        ? lowerTick.minus(TICK_SPACINGS[3000])
        : null
      if (newLowerTick) {
        setLowerTick(newLowerTick)
        return isWethToken0
          ? tickToPrice(wethToken!, squeethToken!, newLowerTick.toNumber())
          : tickToPrice(squeethToken!, wethToken!, newLowerTick.toNumber())
      }
    }
  }, [])
  return getNextTickPrice
}

export default function useIsTickAtLimit(
  feeAmount: FeeAmount | undefined,
  tickLower: number | undefined,
  tickUpper: number | undefined,
) {
  return useMemo(
    () => ({
      [Bound.LOWER]:
        feeAmount && tickLower
          ? tickLower === nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[feeAmount as FeeAmount])
          : undefined,
      [Bound.UPPER]:
        feeAmount && tickUpper
          ? tickUpper === nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[feeAmount as FeeAmount])
          : undefined,
    }),
    [feeAmount, tickLower, tickUpper],
  )
}

export const useGetPosition = () => {
  const contract = useAtomValue(nftManagerContractAtom)

  const getPosition = useCallback(
    async (uniTokenId: number) => {
      if (!contract) return null
      const position = await contract.methods.positions(uniTokenId).call()
      const { nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1 } = position

      return {
        nonce,
        operator,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        liquidity,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
        tokensOwed0,
        tokensOwed1
      }
    },
    [contract],
  )

  return getPosition
}
