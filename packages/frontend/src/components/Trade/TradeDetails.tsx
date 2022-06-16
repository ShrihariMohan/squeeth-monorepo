import { CircularProgress, createStyles, makeStyles, Typography } from '@material-ui/core'
import React, { ReactNode } from 'react'
import clsx from 'clsx'

type TradeDetailsType = {
  actionTitle: string
  amount: string
  unit: string
  value: string
  id?: string
  hint: ReactNode
  isLoading?: boolean
  loadingMessage?: string
}
const useStyles = makeStyles((theme) =>
  createStyles({
    container: {
      borderRadius: theme.spacing(1),
      padding: theme.spacing(1.5),
      width: '300px',
      marginLeft: 'auto',
      marginRight: 'auto',
      marginTop: theme.spacing(2),
      backgroundColor: theme.palette.background.stone,
      textAlign: 'left',
    },
    squeethExp: {
      display: 'flex',
      justifyContent: 'space-between',
      textAlign: 'left',
    },
    squeethExpTxt: {
      fontSize: '20px',
    },
  }),
)

const TradeDetails: React.FC<TradeDetailsType> = ({
  actionTitle,
  amount,
  id,
  unit,
  value,
  hint,
  loadingMessage,
  isLoading,
}) => {
  const classes = useStyles()

  return (
    <div className={classes.container} id={id}>
      <div className={classes.squeethExp}>
        <div>
          <Typography variant="caption">{actionTitle}</Typography>
          <Typography className={clsx(classes.squeethExpTxt, 'collateral-to-deposit', 'trade-details-amount')}>
            {amount}
          </Typography>
        </div>
        <div>
          <Typography variant="caption">${value}</Typography>
          <Typography className={clsx(classes.squeethExpTxt)}>{unit}</Typography>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Typography variant="caption" color="textSecondary">
            {loadingMessage ? loadingMessage : 'Loading'}
          </Typography>
          <CircularProgress color="primary" size="1rem" />
        </div>
      ) : (
        <Typography variant="caption" color="textSecondary">
          {hint}
        </Typography>
      )}
    </div>
  )
}

export default TradeDetails
