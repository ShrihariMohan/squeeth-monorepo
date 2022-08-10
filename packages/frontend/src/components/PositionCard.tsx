import Typography from '@material-ui/core/Typography'
import { createStyles, makeStyles } from '@material-ui/core/styles'
import ArrowRightAltIcon from '@material-ui/icons/ArrowRightAlt'
import BigNumber from 'bignumber.js'
import clsx from 'clsx'
import Link from 'next/link'
import React, { memo, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'

import { PnLType, PositionType, TradeType } from '../types'
import { useVaultLiquidations } from '@hooks/contracts/useLiquidations'
import { usePrevious } from 'react-use'
import { useFirstValidVault, useLPPositionsQuery, useSwaps } from 'src/state/positions/hooks'
import { isLPAtom, positionTypeAtom, swapsAtom, isToHidePnLAtom } from 'src/state/positions/atoms'
import {
  actualTradeTypeAtom,
  isOpenPositionAtom,
  sqthTradeAmountAtom,
  tradeCompletedAtom,
  tradeSuccessAtom,
  tradeTypeAtom,
} from 'src/state/trade/atoms'
import { loadingAtom } from 'src/state/pnl/atoms'
import { useVaultData } from '@hooks/useVaultData'
import useAppEffect from '@hooks/useAppEffect'
import useAppMemo from '@hooks/useAppMemo'
import { HidePnLText } from './HidePnLText'
import { PnLTooltip } from '@components/PnLTooltip'
import usePnL from '@hooks/usePnL'
import floatifyBigNums from '@utils/floatifyBigNums'

const useStyles = makeStyles((theme) =>
  createStyles({
    container: {
      padding: theme.spacing(2),
      width: '420px',
      alignSelf: 'flex-start',
      // background: theme.palette.background.lightStone,
      borderRadius: theme.spacing(1),
      display: 'flex',
      flexDirection: 'column',
      [theme.breakpoints.down('sm')]: {
        width: '100%',
      },
      fontWeight: 700,
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '5px',
    },
    posTypeChange: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    title: {
      padding: theme.spacing(0.4, 1),
      fontSize: '.7rem',
      borderRadius: theme.spacing(0.5),
      // marginLeft: theme.spacing(2),
    },
    positionTitle: {
      color: (props: any): any =>
        props.positionType === PositionType.LONG
          ? theme.palette.success.main
          : props.positionType === PositionType.SHORT
          ? theme.palette.error.main
          : 'inherit',
      backgroundColor: (props: any): any =>
        props.positionType === PositionType.LONG
          ? `${theme.palette.success.main}20`
          : props.positionType === PositionType.SHORT
          ? `${theme.palette.error.main}20`
          : '#DCDAE920',
    },
    postpositionTitle: {
      color: (props: any): any =>
        props.postPosition === PositionType.LONG
          ? theme.palette.success.main
          : props.postPosition === PositionType.SHORT && theme.palette.error.main,
      backgroundColor: (props: any): any =>
        props.postPosition === PositionType.LONG
          ? `${theme.palette.success.main}20`
          : props.postPosition === PositionType.SHORT
          ? `${theme.palette.error.main}20`
          : '#DCDAE920',
    },
    posBg: {
      background: (props: any): any => {
        console.log('position-type-123', props.positionType)
        const positionColor =
          props.positionType === PositionType.LONG
            ? '#375F4290'
            : props.positionType === PositionType.SHORT
            ? '#68373D40'
            : 'rgba(255, 255, 255, 0.08)'
        const postColor =
          props.postPosition === PositionType.LONG
            ? '#375F42'
            : props.postPosition === PositionType.SHORT
            ? '#68373D90'
            : 'rgba(255, 255, 255, 0.08)'
        return `linear-gradient(to right, ${positionColor} 0%,${postColor} 75%)`
      },
      marginTop: ({ isToHidePnL }) => (isToHidePnL ? '-64px' : '0'),
    },
    assetDiv: {
      display: 'flex',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
    },
    red: {
      color: theme.palette.error.main,
    },
    green: {
      color: theme.palette.success.main,
    },
    grey: {
      color: theme.palette.text.secondary,
    },
    floatingContainer: {
      position: 'fixed',
      bottom: '30px',
      left: theme.spacing(4),
      background: theme.palette.background.lightStone,
      padding: theme.spacing(1, 2),
      width: '200px',
      borderRadius: theme.spacing(1),
      backdropFilter: 'blur(50px)',
      zIndex: 10,
    },
    pnl: {
      display: 'flex',
      alignItems: 'baseline',
    },
    postTrade: {
      display: 'flex',
      justifyContent: 'center',
    },
    postAmount: {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
    },
    arrow: {
      color: theme.palette.grey[600],
    },
    link: {
      color: theme.palette.primary.main,
      textDecoration: 'underline',
      fontWeight: 600,
      fontSize: 14,
      width: '100%',
    },
    pnlTitle: {
      display: 'flex',
      alignItems: 'center',
    },
  }),
)

const pnlClass = (pnl: BigNumber, classes: any) => {
  if (pnl.gt(new BigNumber(0))) {
    return classes.green
  }

  if (pnl.lt(new BigNumber(0))) {
    return classes.red
  }

  return classes.grey
}

const PositionCard: React.FC = () => {
  const isToHidePnL = useAtomValue(isToHidePnLAtom)

  const positionType = useAtomValue(positionTypeAtom)
  const { startPolling, stopPolling } = useSwaps()
  const swapsData = useAtomValue(swapsAtom)
  const swaps = swapsData.swaps
  const { validVault: vault, vaultId } = useFirstValidVault()
  const { existingCollat } = useVaultData(vault)
  const { loading: isPositionLoading } = useLPPositionsQuery()
  const isLP = useAtomValue(isLPAtom)
  const isOpenPosition = useAtomValue(isOpenPositionAtom)
  const [tradeSuccess, setTradeSuccess] = useAtom(tradeSuccessAtom)
  const [tradeCompleted, setTradeCompleted] = useAtom(tradeCompletedAtom)

  const { liquidations } = useVaultLiquidations(Number(vaultId))
  const actualTradeType = useAtomValue(actualTradeTypeAtom)
  const tradeAmountInput = useAtomValue(sqthTradeAmountAtom)
  const tradeType = useAtomValue(tradeTypeAtom)
  const prevSwapsData = usePrevious(swaps)
  const tradeAmount = useAppMemo(() => new BigNumber(tradeAmountInput), [tradeAmountInput])
  const [fetchingNew, setFetchingNew] = useState(false)
  const [postTradeAmt, setPostTradeAmt] = useState(new BigNumber(0))
  const [postPosition, setPostPosition] = useState(PositionType.NONE)
  const classes = useStyles({ positionType, postPosition, isToHidePnL })
  const { realizedPnL, unrealizedPnL, sqthAmount, sqthAmountInUSD, loading: pnlLoading } = usePnL()

  useAppEffect(() => {
    if (tradeSuccess && prevSwapsData?.length === swaps?.length) {
      //if trade success and number of swaps is still the same, start swaps polling
      startPolling(500)
      setFetchingNew(true)
    } else {
      setTradeCompleted(false)
      setTradeSuccess(false)
      stopPolling()
      setFetchingNew(false)
    }
  }, [swaps, prevSwapsData, tradeSuccess, setTradeCompleted, startPolling, stopPolling, setTradeSuccess])

  const fullyLiquidated = useAppMemo(() => {
    return Boolean(vault && vault.shortAmount.isZero() && liquidations.length > 0)
  }, [vault, liquidations])

  useAppEffect(() => {
    if (isPositionLoading) return

    let _postTradeAmt = new BigNumber(0)
    let _postPosition = PositionType.NONE

    // if (actualTradeType === TradeType.LONG && positionType !== PositionType.SHORT) {
    //   if (isOpenPosition) {
    //     _postTradeAmt = sqthAmount.plus(tradeAmount)
    //   } else {
    //     _postTradeAmt = sqthAmount.minus(tradeAmount)
    //   }
    //   if (_postTradeAmt.gt(0)) _postPosition = PositionType.LONG
    // } else if (actualTradeType === TradeType.SHORT && positionType !== PositionType.LONG) {
    //   if (isOpenPosition) {
    //     _postTradeAmt = sqthAmount.isGreaterThan(0) ? sqthAmount.plus(tradeAmount) : tradeAmount
    //   } else {
    //     _postTradeAmt = sqthAmount.isGreaterThan(0) ? sqthAmount.minus(tradeAmount) : new BigNumber(0)
    //   }
    //   if (_postTradeAmt.gt(0)) {
    //     _postPosition = PositionType.SHORT
    //   }
    // }

    console.log(floatifyBigNums({ tradeAmount }))

    let signedTradeAmount = tradeAmount
    if (
      (positionType === PositionType.SHORT && isOpenPosition) ||
      (positionType === PositionType.LONG && !isOpenPosition)
    ) {
      signedTradeAmount = signedTradeAmount.negated()
    }

    _postTradeAmt = sqthAmount.plus(signedTradeAmount)
    if (_postTradeAmt.gt(new BigNumber(0))) {
      _postPosition = PositionType.LONG
    } else if (_postTradeAmt.lt(new BigNumber(0))) {
      _postPosition = PositionType.SHORT
    } else {
      _postPosition = PositionType.NONE
    }
    console.log(floatifyBigNums({ sqthAmount, tradeAmount, _postTradeAmt }))

    setPostTradeAmt(_postTradeAmt)
    setPostPosition(_postPosition)
  }, [actualTradeType, isOpenPosition, isPositionLoading, positionType, sqthAmount, tradeAmount])

  const renderPnL = (pnl: BigNumber) => (isToHidePnL ? '--' : pnlLoading ? 'Loading' : `$${pnl.toFixed(2)}`)

  return (
    <div className={clsx(classes.container, classes.posBg)}>
      {!fullyLiquidated ? (
        <div>
          <div className={classes.header}>
            <Typography
              variant="h6"
              component="span"
              style={{ fontWeight: 500, fontSize: '1rem' }}
              color="textSecondary"
            >
              My Position
            </Typography>
            <div className={classes.posTypeChange}>
              <span className={clsx(classes.title, classes.positionTitle)}>{positionType.toUpperCase()}</span>

              {postPosition === positionType ||
              (tradeType === TradeType.LONG && positionType === PositionType.SHORT) ||
              (tradeType === TradeType.SHORT && positionType === PositionType.LONG) ? null : (
                <>
                  <ArrowRightAltIcon className={classes.arrow} />
                  <span className={clsx(classes.title, classes.postpositionTitle)}>{postPosition.toUpperCase()}</span>
                </>
              )}
            </div>
          </div>

          <div className={classes.assetDiv}>
            <div>
              <div className={classes.postAmount}>
                <Typography component="span" style={{ fontWeight: 600 }} id="position-card-before-trade-balance">
                  {sqthAmount.isZero() ? '0' : sqthAmount.absoluteValue().toFixed(6)}
                </Typography>

                {tradeAmount.isLessThanOrEqualTo(0) || tradeAmount.isNaN() || tradeCompleted ? null : (
                  <>
                    <ArrowRightAltIcon className={classes.arrow} />
                    <Typography
                      component="span"
                      style={{
                        fontWeight: 600,
                        color: postTradeAmt.gte(sqthAmount) ? '#49D273' : '#f5475c',
                      }}
                      id="position-card-post-trade-balance"
                    >
                      {postTradeAmt.absoluteValue().toFixed(6)}
                    </Typography>
                  </>
                )}
                <Typography color="textSecondary" component="span" variant="body2">
                  oSQTH &nbsp;
                </Typography>
              </div>
              {pnlLoading ? (
                <Typography variant="caption" color="textSecondary">
                  Loading
                </Typography>
              ) : (
                <Typography variant="caption" color="textSecondary" style={{ marginTop: '.5em' }}>
                  ≈ $ {sqthAmountInUSD.isZero() ? '0' : sqthAmountInUSD.absoluteValue().toFixed(2)}
                </Typography>
              )}
            </div>

            {isToHidePnL || (tradeType === TradeType.SHORT && positionType != PositionType.LONG) ? (
              <HidePnLText />
            ) : (
              <div>
                <div>
                  <div>
                    <div>
                      <Typography variant="caption" color="textSecondary" style={{ fontWeight: 500 }}>
                        Unrealized P&L
                      </Typography>
                      <PnLTooltip pnlType={PnLType.Unrealized} />
                    </div>
                    <div className={classes.pnl} id="unrealized-pnl-value">
                      {!pnlLoading ? (
                        <>
                          <Typography
                            className={pnlClass(unrealizedPnL, classes)}
                            style={{ fontWeight: 600 }}
                            id="unrealized-pnl-usd-value"
                          >
                            {renderPnL(unrealizedPnL)}
                          </Typography>
                          {/* <Typography
                            variant="caption"
                            className={pnlClass(positionType, longGain, shortGain, classes)}
                            style={{ marginLeft: '4px' }}
                            id="unrealized-pnl-perct-value"
                          >
                            {getPositionBasedValue(
                              `(${longGain.toFixed(2)}%)`,
                              `(${shortGain.toFixed(2)}%)`,
                              null,
                              ' ',
                            )}
                          </Typography> */}
                        </>
                      ) : (
                        'Loading'
                      )}
                    </div>
                  </div>
                  <div className={classes.pnlTitle}>
                    <Typography variant="caption" color="textSecondary" style={{ fontWeight: 500 }}>
                      Realized P&L
                    </Typography>
                    <PnLTooltip pnlType={PnLType.Realized} />
                  </div>
                  <div className={classes.pnl} id="realized-pnl-value">
                    <Typography className={pnlClass(realizedPnL, classes)} style={{ fontWeight: 600 }}>
                      {renderPnL(realizedPnL)}
                    </Typography>
                  </div>
                </div>
              </div>
            )}
          </div>

          {positionType === PositionType.SHORT ? (
            <Typography variant="caption" className={classes.link} id="pos-card-manage-vault-link">
              <Link href={`vault/${vaultId}`}>Manage Vault</Link>
            </Typography>
          ) : null}

          {isLP ? (
            <Typography className={classes.link}>
              <Link href="h1">Manage LP</Link>
            </Typography>
          ) : null}
        </div>
      ) : (
        <div>
          <Typography style={{ fontWeight: 600 }}>FULLY LIQUIDATED</Typography>
          <Typography variant="caption" component="span" style={{ fontWeight: 500 }} color="textSecondary">
            REDEEMABLE COLLATERAL
          </Typography>
          <Typography variant="body1">
            {isPositionLoading && existingCollat.isEqualTo(0) ? 'Loading' : existingCollat.toFixed(4)} ETH
          </Typography>
        </div>
      )}
      <Typography variant="caption" color="textSecondary">
        {fetchingNew ? 'Fetching latest position' : ' '}
      </Typography>
    </div>
  )
}

const MemoizedPositionCard = memo(PositionCard)

export default MemoizedPositionCard
// function getPositionBasedValue(amountOut: BigNumber, buyQuote: BigNumber, arg2: BigNumber) {
//   throw new Error('Function not implemented.')
// }
