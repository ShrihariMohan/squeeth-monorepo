import { createStyles, makeStyles, Tooltip, Snackbar, Collapse, styled } from '@material-ui/core'
import { yellow } from '@material-ui/core/colors'
import Alert from '@material-ui/lab/Alert'
import React from 'react'

import Slider from './CustomSlider'

const useStyles = makeStyles((theme) =>
  createStyles({
    container: {
      width: '300px',
      marginLeft: 'auto',
      marginRight: 'auto',
    },
    danger: {
      backgroundColor: theme.palette.error.main,
    },
    warning: {
      backgroundColor: yellow[700],
    },
    safe: {
      backgroundColor: theme.palette.success.main,
    },
  }),
)

type CollatRangeType = {
  id?: string
  collatValue: number
  onCollatValueChange: (val: number) => void
  className?: string
  minCR?: number
}

const marks = [
  {
    value: 150,
    label: 'DANGER',
  },
  {
    value: 200,
    label: 'RISKY',
  },
  {
    value: 225,
    label: 'SAFE',
  },
]

const CollatRange: React.FC<CollatRangeType> = ({ id, collatValue, onCollatValueChange, className, minCR = 150 }) => {
  const classes = useStyles()

  const minCollatRatio = isNaN(minCR) || minCR < 150 ? 150 : minCR
  const changeSlider = (val: number[]) => {
    if (val[1] < minCollatRatio) return

    onCollatValueChange(val[1])
  }

  // eslint-disable-next-line react/display-name
  const ThumbComponent = React.useCallback((props: any) => {
    if (props['data-index'] === 0) {
      props.style.backgroundColor = 'grey'
      props.style.height = 10
      props.style.marginTop = '-2px'

      return (
        <Tooltip title="Minimum collateralization ratio">
          <span {...props}></span>
        </Tooltip>
      )
    }

    return <span {...props}></span>
  }, [])

  const sliderClass = collatValue < 200 ? classes.danger : collatValue < 225 ? classes.warning : classes.safe

  return (
    <div className={classes.container} id={id}>
      {collatValue === 150 && <div style={{ color: 'red' }}></div>}
      <Slider
        value={[minCollatRatio, collatValue]}
        ThumbComponent={ThumbComponent}
        onChange={(_, val) => changeSlider(val as number[])}
        step={0.1}
        style={{ width: '100%' }}
        classes={{
          thumb: sliderClass,
          track: sliderClass,
        }}
        className={className}
        marks={
          minCollatRatio < 200
            ? marks
            : minCollatRatio < 225
            ? [
                {
                  value: 200,
                  label: <span style={{ color: '#fbc02d', position: 'absolute', left: '-25px' }}>RISKY</span>,
                },
                {
                  value: 225,
                  label: <span style={{ color: '#49D273', marginLeft: '1em' }}>SAFE</span>,
                },
              ]
            : [
                {
                  value: 225,
                  label: <span style={{ color: '#49D273' }}>SAFE</span>,
                },
              ]
        }
        min={minCollatRatio}
        max={minCollatRatio * 2}
        id={id + '-slider'}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '.75em' }}>
        <Collapse in={collatValue === 150}>
          <Alert severity="error" id={id + '-alert-text'}>
            You will get liquidated
          </Alert>
        </Collapse>
        <Collapse in={collatValue !== 150 && collatValue < 175}>
          <Alert severity="warning" id={id + '-alert-text'}>
            Collateral ratio is risky. You will get liquidated at 150%.
          </Alert>
        </Collapse>
      </div>
    </div>
  )
}

export default CollatRange
