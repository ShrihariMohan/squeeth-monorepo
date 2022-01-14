import CustomLinearProgress from '@components/CustomProgress'
import { LinearProgress, Typography } from '@material-ui/core'
import { createStyles, makeStyles } from '@material-ui/core/styles'
import BigNumber from 'bignumber.js'
import React from 'react'

const useStyles = makeStyles((theme) =>
  createStyles({
    container: {
      padding: theme.spacing(2, 5),
      background: theme.palette.background.stone,
      borderRadius: theme.spacing(2),
      width: '640px',
    },
    vaultDetails: {
      display: 'flex',
      justifyContent: 'space-between',
    },
    vaultProgress: {
      marginTop: theme.spacing(2),
    },
  }),
)

type CapType = {
  maxCap: BigNumber
  depositedAmount: BigNumber
}

const CapDetails: React.FC<CapType> = ({ maxCap, depositedAmount }) => {
  const classes = useStyles()

  return (
    <div className={classes.container}>
      <div className={classes.vaultDetails}>
        <div>
          <Typography variant="body2" color="textSecondary">
            Vault Deposits
          </Typography>
          <Typography variant="h6">{Number(depositedAmount.toFixed(4)).toLocaleString()} ETH</Typography>
        </div>
        <div>
          <Typography variant="body2" color="textSecondary">
            Vault Capacity
          </Typography>
          <Typography variant="h6">{Number(maxCap.toFixed(4)).toLocaleString()} ETH</Typography>
        </div>
      </div>
      <div className={classes.vaultProgress}>
        <CustomLinearProgress variant="determinate" value={depositedAmount.div(maxCap).times(100).toNumber()} />
      </div>
    </div>
  )
}

export default CapDetails