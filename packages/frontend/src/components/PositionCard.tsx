import Typography from '@material-ui/core/Typography'
import { createStyles, makeStyles } from '@material-ui/core/styles'
import ArrowRightAltIcon from '@material-ui/icons/ArrowRightAlt'
import BigNumber from 'bignumber.js'
import clsx from 'clsx'
import Link from 'next/link'
import React, { memo, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { usePrevious } from 'react-use'

import { PnLType, PositionType, TradeType } from '../types'
import { useVaultLiquidations } from '@hooks/contracts/useLiquidations'
import { useFirstValidVault, useLPPositionsQuery } from 'src/state/positions/hooks'
import { isLPAtom } from 'src/state/positions/atoms'

import {
  actualTradeTypeAtom,
  isOpenPositionAtom,
  sqthTradeAmountAtom,
  tradeCompletedAtom,
  tradeSuccessAtom,
  tradeTypeAtom,
} from 'src/state/trade/atoms'
import { useVaultData } from '@hooks/useVaultData'
import useAppEffect from '@hooks/useAppEffect'
import useAppMemo from '@hooks/useAppMemo'
import { PnLTooltip } from '@components/PnLTooltip'
import usePositionNPnL from '@hooks/usePositionNPnL'
import useAccounts from '@hooks/useAccounts'

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

const pnlClass = (positionType: PositionType, num: BigNumber, classes: any) => {
  if (positionType != PositionType.NONE) {
    if (num.gt(0)) return classes.green
    else return classes.red
  }
  return classes.grey
}

const PositionCard: React.FC = () => {
  const { startPolling, stopPolling } = useAccounts()
  const {
    positionType,
    realizedPnL,
    unrealizedPnL,
    loading: isPnLLoading,
    realizedPnLInPerct,
    unrealizedPnLInPerct,
    currentOSQTHAmount,
    currentPositionValue,
  } = usePositionNPnL()
  const prevSqueethAmount = usePrevious(currentOSQTHAmount)

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
  const tradeAmount = useAppMemo(() => new BigNumber(tradeAmountInput), [tradeAmountInput])
  const [fetchingNew, setFetchingNew] = useState(false)
  const [postTradeAmt, setPostTradeAmt] = useState(new BigNumber(0))
  const [postPosition, setPostPosition] = useState(PositionType.NONE)
  const classes = useStyles({ positionType, postPosition })

  useAppEffect(() => {
    if (tradeSuccess && prevSqueethAmount?.isEqualTo(currentOSQTHAmount)) {
      console.log('currentOSQTHAmount', currentOSQTHAmount, prevSqueethAmount)
      startPolling(500)
      setFetchingNew(true)
    } else {
      console.log('stop polling', currentOSQTHAmount, prevSqueethAmount)
      setTradeCompleted(false)
      stopPolling()
      setTradeSuccess(false)
      setFetchingNew(false)
    }
  }, [
    tradeSuccess,
    setTradeCompleted,
    setTradeSuccess,
    prevSqueethAmount,
    currentOSQTHAmount,
    startPolling,
    stopPolling,
  ])

  const fullyLiquidated = useAppMemo(() => {
    return Boolean(vault && vault.shortAmount.isZero() && liquidations.length > 0)
  }, [vault, liquidations])

  useAppEffect(() => {
    if (isPositionLoading) return

    let _postTradeAmt = new BigNumber(0)
    let _postPosition = PositionType.NONE
    if (actualTradeType === TradeType.LONG && positionType !== PositionType.SHORT) {
      if (isOpenPosition) {
        _postTradeAmt = currentOSQTHAmount.plus(tradeAmount)
      } else {
        _postTradeAmt = currentOSQTHAmount.minus(tradeAmount)
      }
      if (_postTradeAmt.gt(0)) _postPosition = PositionType.LONG
    } else if (actualTradeType === TradeType.SHORT && positionType !== PositionType.LONG) {
      if (isOpenPosition) {
        _postTradeAmt = currentOSQTHAmount.isGreaterThan(0) ? currentOSQTHAmount.plus(tradeAmount) : tradeAmount
      } else {
        _postTradeAmt = currentOSQTHAmount.isGreaterThan(0) ? currentOSQTHAmount.minus(tradeAmount) : new BigNumber(0)
      }
      if (_postTradeAmt.gt(0)) {
        _postPosition = PositionType.SHORT
      }
    }

    setPostTradeAmt(_postTradeAmt)
    setPostPosition(_postPosition)
  }, [actualTradeType, isOpenPosition, isPositionLoading, positionType, currentOSQTHAmount, tradeAmount])

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
                  {currentOSQTHAmount.toFixed(6)}
                </Typography>

                {(tradeType === TradeType.SHORT && positionType === PositionType.LONG) ||
                (tradeType === TradeType.LONG && positionType === PositionType.SHORT) ||
                tradeAmount.isLessThanOrEqualTo(0) ||
                tradeAmount.isNaN() ||
                tradeCompleted ? null : (
                  <>
                    <ArrowRightAltIcon className={classes.arrow} />
                    <Typography
                      component="span"
                      style={{
                        fontWeight: 600,
                        color: postTradeAmt.gte(currentOSQTHAmount) ? '#49D273' : '#f5475c',
                      }}
                      id="position-card-post-trade-balance"
                    >
                      {postTradeAmt.lte(0) ? 0 : postTradeAmt.toFixed(6)}
                    </Typography>
                  </>
                )}
                <Typography color="textSecondary" component="span" variant="body2">
                  oSQTH &nbsp;
                </Typography>
              </div>

              <Typography variant="caption" color="textSecondary" style={{ marginTop: '.5em' }}>
                ≈ $ {currentPositionValue.toFixed(2)}
              </Typography>
            </div>

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
                    {!isPnLLoading ? (
                      <>
                        <Typography
                          className={pnlClass(positionType, unrealizedPnL, classes)}
                          style={{ fontWeight: 600 }}
                          id="unrealized-pnl-usd-value"
                        >
                          {unrealizedPnL.toFixed(2)}
                        </Typography>
                        <Typography
                          variant="caption"
                          className={pnlClass(positionType, unrealizedPnLInPerct, classes)}
                          style={{ marginLeft: '4px' }}
                          id="unrealized-pnl-perct-value"
                        >
                          ({unrealizedPnLInPerct.toFixed(2)}%)
                        </Typography>
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
                  <Typography className={pnlClass(positionType, realizedPnL, classes)} style={{ fontWeight: 600 }}>
                    {realizedPnL.toFixed(2)}
                  </Typography>
                  <Typography
                    variant="caption"
                    className={pnlClass(positionType, realizedPnLInPerct, classes)}
                    style={{ marginLeft: '4px' }}
                    id="unrealized-pnl-perct-value"
                  >
                    ({realizedPnLInPerct.toFixed(2)}%)
                  </Typography>
                </div>
              </div>
            </div>
          </div>
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
  )
}

const MemoizedPositionCard = memo(PositionCard)

export default MemoizedPositionCard
// function getPositionBasedValue(amountOut: BigNumber, buyQuote: BigNumber, arg2: BigNumber) {
//   throw new Error('Function not implemented.')
// }
