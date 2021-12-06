import { CircularProgress, InputAdornment, TextField, Typography } from '@material-ui/core'
import { orange } from '@material-ui/core/colors'
import { createStyles, makeStyles } from '@material-ui/core/styles'
import BigNumber from 'bignumber.js'
import clsx from 'clsx'
import Image from 'next/image'
import { useRouter } from 'next/router'
import React, { useEffect, useMemo, useState } from 'react'

import ethLogo from '../../public/images/ethereum-eth.svg'
import squeethLogo from '../../public/images/Squeeth.svg'
import { AddButton, RemoveButton } from '../../src/components/Buttons'
import CollatRange from '../../src/components/CollatRange'
import NumberInput from '../../src/components/inputs/NumberInput'
import Nav from '../../src/components/Nav'
import TradeInfoItem from '../../src/components/Trade/TradeInfoItem'
import { WSQUEETH_DECIMALS } from '../../src/constants'
import { useWallet } from '../../src/context/wallet'
import { useController } from '../../src/hooks/contracts/useController'
import { useTokenBalance } from '../../src/hooks/contracts/useTokenBalance'
import { useAddresses } from '../../src/hooks/useAddress'
import { CollateralStatus, Vault } from '../../src/types'
import { getCollatPercentStatus, toTokenAmount } from '../../src/utils/calculations'

const useStyles = makeStyles((theme) =>
  createStyles({
    container: {
      margin: theme.spacing(6, 8),
      width: '800px',
      marginLeft: 'auto',
      marginRight: 'auto',
      [theme.breakpoints.down('sm')]: {
        width: '100%',
        padding: theme.spacing(0, 2),
      },
    },
    overview: {
      display: 'flex',
      marginTop: theme.spacing(2),
      justifyContent: 'space-between',
    },
    overviewItem: {
      display: 'flex',
      flexDirection: 'column',
      background: theme.palette.background.stone,
      // height: '75px',
      width: '190px',
      borderRadius: theme.spacing(2),
      padding: theme.spacing(2, 3),
    },
    overviewTitle: {
      fontSize: '14px',
      color: theme.palette.text.secondary,
      fontWeight: 600,
    },
    overviewValue: {
      fontSize: '22px',
    },
    manager: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: theme.spacing(6),
    },
    managerItem: {
      background: theme.palette.background.stone,
      width: '380px',
      borderRadius: theme.spacing(2),
      padding: theme.spacing(2, 3),
    },
    managerItemHeader: {
      display: 'flex',
      alignItems: 'center',
    },
    managerItemTitle: {
      fontSize: '24px',
      marginLeft: theme.spacing(1),
      fontWeight: 300,
    },
    managerActions: {
      margin: 'auto',
      width: '300px',
      display: 'flex',
      justifyContent: 'space-around',
    },
    actionBtn: {
      width: '75px',
    },
    collatContainer: {
      margin: 'auto',
      width: '300px',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      marginTop: '16px',
    },
    txDetails: {
      background: theme.palette.background.paper,
      width: '300px',
      borderRadius: theme.spacing(1),
      marginLeft: 'auto',
      marginRight: 'auto',
      marginBottom: theme.spacing(2),
      padding: theme.spacing(1),
    },
    collatStatus: {
      padding: theme.spacing(0, 1),
      borderRadius: theme.spacing(0.5),
      fontSize: '10px',
      fontWeight: 600,
    },
    safe: {
      background: `${theme.palette.success.main}30`,
      color: theme.palette.success.main,
    },
    risky: {
      background: `${orange[600]}30`,
      color: orange[600],
    },
    danger: {
      background: `${theme.palette.error.main}30`,
      color: theme.palette.error.main,
    },
    loading: {
      width: '100%',
      display: 'flex',
      justifyContent: 'center',
      marginTop: theme.spacing(8),
    },
  }),
)

enum VaultAction {
  ADD_COLLATERAL,
  REMOVE_COLLATERAL,
  MINT_SQUEETH,
  BURN_SQUEETH,
}

enum VaultError {
  MIN_COLLATERAL = 'Minimum vault collateral is 0.5 ETH',
  MIN_COLLAT_PERCENT = 'Minimum collateral ratio is 150%',
}

const Component: React.FC = () => {
  const classes = useStyles()
  const router = useRouter()
  const {
    getVault,
    getCollatRatioAndLiqPrice,
    getDebtAmount,
    getShortAmountFromDebt,
    normFactor,
    depositCollateral,
    withdrawCollateral,
    openDepositAndMint,
    burnAndRedeem,
  } = useController()
  const { wSqueeth } = useAddresses()
  const { balance, address, connected } = useWallet()
  const { vid } = router.query

  const squeethBal = useTokenBalance(wSqueeth, 20, WSQUEETH_DECIMALS)

  const [vault, setVault] = useState<Vault | null>(null)
  const [existingCollatPercent, setExistingCollatPercent] = useState(0)
  const [existingLiqPrice, setExistingLiqPrice] = useState(0)
  const [collateral, setCollateral] = useState(new BigNumber(0))
  const [collatPercent, setCollatPercent] = useState(0)
  const [shortAmount, setShortAmount] = useState(new BigNumber(0))
  const [newLiqPrice, setNewLiqPrice] = useState(0)
  const [action, setAction] = useState(VaultAction.ADD_COLLATERAL)
  const [txLoading, setTxLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)

  const updateVault = () => {
    if (!Number(vid)) return
    getVault(Number(vid)).then((v) => {
      setVault(v)
      if (!v) return
      getCollatRatioAndLiqPrice(v?.collateralAmount, v?.shortAmount).then(({ collateralPercent, liquidationPrice }) => {
        setExistingCollatPercent(collateralPercent)
        setCollatPercent(collateralPercent)
        setExistingLiqPrice(liquidationPrice)
        setPageLoading(false)
      })
    })
  }

  useEffect(() => {
    if (vid && connected) updateVault()
  }, [vid, normFactor.toString(), address, connected])

  const updateCollateral = async (collatAmount: BigNumber) => {
    setCollateral(collatAmount)
    if (!vault) return

    const { collateralPercent: cp, liquidationPrice: lp } = await getCollatRatioAndLiqPrice(
      collatAmount.plus(vault.collateralAmount), // Get liquidation price and collatPercent for total collat after tx happens
      vault.shortAmount,
    )
    setNewLiqPrice(lp)
    setCollatPercent(cp)
    setAction(collatAmount.isPositive() ? VaultAction.ADD_COLLATERAL : VaultAction.REMOVE_COLLATERAL)
  }

  const updateCollatPercent = async (percent: number) => {
    if (!vault) return

    setAction(percent > existingCollatPercent ? VaultAction.ADD_COLLATERAL : VaultAction.REMOVE_COLLATERAL)
    setCollatPercent(percent)
    const debt = await getDebtAmount(vault.shortAmount)
    const newCollat = new BigNumber(percent).times(debt).div(100)
    const { liquidationPrice: lp } = await getCollatRatioAndLiqPrice(newCollat, vault.shortAmount)
    setNewLiqPrice(lp)
    setCollateral(newCollat.minus(vault.collateralAmount))
  }

  const updateShort = async (shortAmount: BigNumber) => {
    setShortAmount(shortAmount)
    if (!vault) return

    const { collateralPercent: cp, liquidationPrice: lp } = await getCollatRatioAndLiqPrice(
      vault.collateralAmount,
      shortAmount.plus(vault.shortAmount),
    )
    setNewLiqPrice(lp)
    setCollatPercent(cp)
    setAction(shortAmount.isPositive() ? VaultAction.MINT_SQUEETH : VaultAction.BURN_SQUEETH)
  }

  const updateDebtForCollatPercent = async (percent: number) => {
    setCollatPercent(percent)
    if (!vault) return

    const debt = vault.collateralAmount.times(100).div(percent)
    const _shortAmt = await getShortAmountFromDebt(debt)
    setShortAmount(_shortAmt.minus(vault.shortAmount))
    setAction(percent < existingCollatPercent ? VaultAction.MINT_SQUEETH : VaultAction.BURN_SQUEETH)
    const { liquidationPrice: lp } = await getCollatRatioAndLiqPrice(vault.collateralAmount, _shortAmt)
    setNewLiqPrice(lp)
  }

  const addCollat = async (collatAmount: BigNumber) => {
    if (!vault) return

    setTxLoading(true)
    try {
      await depositCollateral(vault.id, collatAmount)
      updateVault()
    } catch (e) {
      console.log(e)
    }
    setTxLoading(false)
  }

  const removeCollat = async (collatAmount: BigNumber) => {
    if (!vault) return

    setTxLoading(true)
    try {
      await withdrawCollateral(vault.id, collatAmount.abs())
      updateVault()
    } catch (e) {
      console.log(e)
    }
    setTxLoading(false)
  }

  const mint = async (sAmount: BigNumber) => {
    if (!vault) return

    setTxLoading(true)
    try {
      await openDepositAndMint(vault.id, sAmount, new BigNumber(0))
      updateVault()
    } catch (e) {
      console.log(e)
    }
    setTxLoading(false)
  }

  const burn = async (sAmount: BigNumber) => {
    if (!vault) return

    setTxLoading(true)
    try {
      await burnAndRedeem(vault.id, sAmount.abs(), new BigNumber(0))
      updateVault()
    } catch (e) {
      console.log(e)
    }
    setTxLoading(false)
  }

  const isCollatAction = useMemo(() => {
    return action === VaultAction.ADD_COLLATERAL || action === VaultAction.REMOVE_COLLATERAL
  }, [action])

  const { adjustAmountError, adjustCollatError } = useMemo(() => {
    let adjustCollatError = null
    let adjustAmountError = null
    if (isCollatAction) {
      if (vault?.collateralAmount.minus(collateral.negated()).lt(0.5)) adjustCollatError = VaultError.MIN_COLLATERAL
      else if (collatPercent < 150) adjustCollatError = VaultError.MIN_COLLAT_PERCENT
    } else {
      if (collatPercent < 150) adjustAmountError = VaultError.MIN_COLLAT_PERCENT
    }

    return { adjustAmountError, adjustCollatError }
  }, [shortAmount.toString(), collateral.toString(), collatPercent, action])

  const collatStatus = useMemo(() => {
    return getCollatPercentStatus(existingCollatPercent)
  }, [existingCollatPercent])

  const collatClass = useMemo(() => {
    if (collatStatus === CollateralStatus.SAFE) return classes.safe
    if (collatStatus === CollateralStatus.RISKY) return classes.risky
    return classes.danger
  }, [collatStatus])

  return (
    <div>
      <Nav />
      {pageLoading ? (
        <div className={classes.loading}>
          <Typography variant="h5" color="textSecondary">
            Loading...
          </Typography>
        </div>
      ) : (
        <div className={classes.container}>
          <Typography color="primary" variant="h6">
            Manage Vault #{vid}
          </Typography>
          <div className={classes.overview}>
            <div className={classes.overviewItem}>
              <Typography className={classes.overviewValue}>{vault?.shortAmount.toFixed(6)}</Typography>
              <Typography className={classes.overviewTitle}>Debt (oSQTH)</Typography>
            </div>
            <div className={classes.overviewItem}>
              <Typography className={classes.overviewValue}>{vault?.collateralAmount.toFixed(4)}</Typography>
              <Typography className={classes.overviewTitle}>Collateral (ETH)</Typography>
            </div>
            <div className={classes.overviewItem}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography className={classes.overviewValue}>{existingCollatPercent || 0} %</Typography>
                <Typography className={clsx(classes.collatStatus, collatClass)} variant="caption">
                  {getCollatPercentStatus(existingCollatPercent)}
                </Typography>
              </div>
              <Typography className={classes.overviewTitle}>Collateral percent</Typography>
            </div>
            <div className={classes.overviewItem}>
              <Typography className={classes.overviewValue}>$ {existingLiqPrice.toFixed(2)}</Typography>
              <Typography className={classes.overviewTitle}>Liquidation Price</Typography>
            </div>
          </div>
          <div className={classes.manager}>
            <div className={classes.managerItem}>
              <div className={classes.managerItemHeader}>
                <div style={{ marginLeft: '16px', width: '40px', height: '40px' }}>
                  <Image src={ethLogo} alt="logo" width={40} height={40} />
                </div>
                <Typography className={classes.managerItemTitle} variant="h6">
                  Adjust Collateral
                </Typography>
              </div>
              <div style={{ margin: 'auto', width: '300px', marginTop: '24px' }}>
                <NumberInput
                  min={vault?.collateralAmount.negated()}
                  step={0.1}
                  placeholder="Collateral"
                  onChange={(v) => updateCollateral(v)}
                  value={collateral}
                  unit="ETH"
                  hint={
                    !!adjustCollatError ? adjustCollatError : `Balance ${toTokenAmount(balance, 18).toFixed(4)} ETH`
                  }
                  error={!!adjustCollatError}
                />
              </div>
              <div className={classes.collatContainer}>
                <TextField
                  size="small"
                  type="number"
                  style={{ width: 150, marginRight: '4px' }}
                  onChange={(event) => updateCollatPercent(Number(event.target.value))}
                  value={isCollatAction ? collatPercent : existingCollatPercent}
                  id="filled-basic"
                  label="Ratio"
                  variant="outlined"
                  // error={collatPercent < 150}
                  // helperText={`Balance ${toTokenAmount(balance, 18).toFixed(4)} ETH`}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Typography variant="caption">%</Typography>
                      </InputAdornment>
                    ),
                  }}
                  inputProps={{
                    min: '0',
                  }}
                />
                <CollatRange
                  collatValue={isCollatAction ? collatPercent : existingCollatPercent}
                  onCollatValueChange={updateCollatPercent}
                />
              </div>
              <div className={classes.txDetails}>
                <TradeInfoItem
                  label="New liquidation price"
                  value={isCollatAction ? (newLiqPrice || 0).toFixed(2) : '0'}
                  frontUnit="$"
                />
              </div>
              <div className={classes.managerActions}>
                <RemoveButton
                  className={classes.actionBtn}
                  size="small"
                  disabled={action !== VaultAction.REMOVE_COLLATERAL || txLoading || !!adjustCollatError}
                  onClick={() => removeCollat(collateral.abs())}
                >
                  {action === VaultAction.REMOVE_COLLATERAL && txLoading ? (
                    <CircularProgress color="primary" size="1rem" />
                  ) : (
                    'Remove'
                  )}
                </RemoveButton>
                <AddButton
                  onClick={() => addCollat(collateral)}
                  className={classes.actionBtn}
                  size="small"
                  disabled={action !== VaultAction.ADD_COLLATERAL || txLoading || !!adjustCollatError}
                >
                  {action === VaultAction.ADD_COLLATERAL && txLoading ? (
                    <CircularProgress color="primary" size="1rem" />
                  ) : (
                    'Add'
                  )}
                </AddButton>
              </div>
            </div>
            <div className={classes.managerItem}>
              <div className={classes.managerItemHeader}>
                <div style={{ marginLeft: '16px', width: '40px', height: '40px' }}>
                  <Image src={squeethLogo} alt="logo" width={40} height={40} />
                </div>
                <Typography className={classes.managerItemTitle} variant="h6">
                  Adjust Debt
                </Typography>
              </div>
              <div style={{ margin: 'auto', width: '300px', marginTop: '24px' }}>
                <NumberInput
                  min={squeethBal.negated()}
                  step={0.1}
                  placeholder="Amount"
                  onChange={(v) => updateShort(v)}
                  value={shortAmount}
                  unit="oSQTH"
                  hint={!!adjustAmountError ? adjustAmountError : `Balance ${squeethBal.toFixed(6)} oSQTH`}
                  error={!!adjustAmountError}
                />
                <div className={classes.collatContainer}>
                  <TextField
                    size="small"
                    type="number"
                    style={{ width: 150, marginRight: '4px' }}
                    onChange={(event) => updateDebtForCollatPercent(Number(event.target.value))}
                    value={!isCollatAction ? collatPercent : existingCollatPercent}
                    id="filled-basic"
                    label="Ratio"
                    variant="outlined"
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <Typography variant="caption">%</Typography>
                        </InputAdornment>
                      ),
                    }}
                    inputProps={{
                      min: '0',
                    }}
                  />
                  <CollatRange
                    collatValue={!isCollatAction ? collatPercent : existingCollatPercent}
                    onCollatValueChange={updateDebtForCollatPercent}
                  />
                </div>
              </div>
              <div className={classes.txDetails}>
                <TradeInfoItem
                  label="New liquidation price"
                  value={!isCollatAction ? (newLiqPrice || 0).toFixed(2) : '0'}
                  frontUnit="$"
                />
              </div>
              <div className={classes.managerActions}>
                <RemoveButton
                  onClick={() => burn(shortAmount)}
                  className={classes.actionBtn}
                  size="small"
                  disabled={action !== VaultAction.BURN_SQUEETH || txLoading || !!adjustAmountError}
                >
                  {action === VaultAction.BURN_SQUEETH && txLoading ? (
                    <CircularProgress color="primary" size="1rem" />
                  ) : (
                    'Burn'
                  )}
                </RemoveButton>
                <AddButton
                  onClick={() => mint(shortAmount)}
                  className={classes.actionBtn}
                  size="small"
                  disabled={action !== VaultAction.MINT_SQUEETH || txLoading || !!adjustAmountError}
                >
                  {action === VaultAction.MINT_SQUEETH && txLoading ? (
                    <CircularProgress color="primary" size="1rem" />
                  ) : (
                    'Mint'
                  )}
                </AddButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Component